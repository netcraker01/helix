/**
 * Remote player store tests.
 *
 * Verifies that remote playback via HTMLAudio delegates correctly
 * and handles stream-resolved events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pauseRemote,
  resumeRemote,
  seekRemote,
  stopRemote,
  remoteActive,
  proxyLocalUrl,
  loadRemoteStream,
  getAudioElement,
  setRemoteVolume,
} from './remotePlayer';
import {
  reResolveStream,
  cacheRemoteStream,
  reportRemoteAudioPlaybackFailure,
  reportRemoteAudioPlaybackRuntimeFailure,
  reportRemoteAudioPlaybackSuccess,
} from '@services/commands';
import { Source, type Track } from '@shared/types/models';
import { isPlaying, visualizerReactivity } from './player';

const { readable } = await vi.hoisted(() => import('svelte/store'));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

vi.mock('@shared/stores/notifications', () => ({
  notifications: {
    push: vi.fn(),
  },
}));

vi.mock('@i18n', () => {
  const translateFn = (key: string, params?: Record<string, string | number>) => {
    if (params?.default) return params.default as string;
    return key;
  };
  const store = readable(translateFn, () => {});
  return { t: store };
});

vi.mock('@services/commands', () => ({
    cacheRemoteStream: vi.fn(),
    prefetchNextStream: vi.fn().mockResolvedValue(undefined),
    reResolveStream: vi.fn().mockResolvedValue(undefined),
    reportRemoteAudioPlaybackFailure: vi.fn().mockResolvedValue(undefined),
    reportRemoteAudioPlaybackRuntimeFailure: vi.fn().mockResolvedValue(undefined),
    reportRemoteAudioPlaybackSuccess: vi.fn().mockResolvedValue(undefined),
}));

function get(store: { subscribe: (fn: (v: unknown) => void) => () => void }): unknown {
  let value: unknown;
  store.subscribe((v) => {
    value = v;
  })();
  return value;
}

beforeEach(() => {
  // Reset the module-level audio element between tests
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  stopRemote();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('remotePlayer store', () => {
  it('sets remoteActive to false initially', () => {
    expect(get(remoteActive)).toBe(false);
  });

  it('stops remote playback and clears state', () => {
    stopRemote();
    expect(get(remoteActive)).toBe(false);
  });

  it('routes cached files through the same capability-gated proxy as remote streams', () => {
    const url = proxyLocalUrl(8765, 'per-process-capability', '/tmp/cached track.m4a');

    expect(url).toContain('/proxy?cap=per-process-capability&url=');
    expect(url).toContain(encodeURIComponent('file:///tmp/cached track.m4a'));
  });

  it('does not attempt an unguarded proxy swap when the capability is unavailable', () => {
    expect(proxyLocalUrl(8765, undefined, '/tmp/cached.m4a')).not.toContain('/proxy?');
  });

  it('uses direct HTMLAudio output on Linux without creating MediaElementSource on the primary element', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Jellyx WebKitGTK Linux');
    const createMediaElementSource = vi.fn((_el: HTMLAudioElement) => ({ connect: vi.fn() }));
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = function MockAudioContext() {
      return {
        createMediaElementSource,
        createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
        createAnalyser: vi.fn(() => ({
          fftSize: 0,
          smoothingTimeConstant: 0,
          frequencyBinCount: 512,
          connect: vi.fn(),
          getByteFrequencyData: vi.fn(),
        })),
        destination: {},
        sampleRate: 48_000,
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as AudioContext;
    } as unknown as typeof AudioContext;
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const track = {
      id: 'linux-direct', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'linux-direct', streamUrl: 'http://127.0.0.1:8765/proxy?linux-direct',
    } as Track;

    try {
      await loadRemoteStream(track, track.streamUrl!);
      setRemoteVolume(35);

      // createMediaElementSource MUST be called (on the clone), but NEVER on
      // the primary audio element — the primary keeps its native direct output.
      expect(createMediaElementSource).toHaveBeenCalled();
      const analysedEl = createMediaElementSource.mock.calls[0][0] as unknown as HTMLAudioElement;
      expect(analysedEl).not.toBe(getAudioElement());
      expect(getAudioElement()?.volume).toBeCloseTo(0.35);
    } finally {
      window.AudioContext = OriginalAudioContext;
      userAgent.mockRestore();
      play.mockRestore();
    }
  });

  it('keeps Web Audio ownership and GainNode volume on non-Linux', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Jellyx WebKit macOS');
    const connect = vi.fn();
    const gain = { gain: { value: 0 }, connect };
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 512,
      connect,
      getByteFrequencyData: vi.fn(),
    };
    const createMediaElementSource = vi.fn((_el: HTMLAudioElement) => ({ connect }));
    const context = {
      state: 'running',
      sampleRate: 48_000,
      destination: {},
      createMediaElementSource,
      createGain: vi.fn(() => gain),
      createAnalyser: vi.fn(() => analyser),
      resume: vi.fn().mockResolvedValue(undefined),
    };
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = function MockAudioContext() {
      return context as unknown as AudioContext;
    } as unknown as typeof AudioContext;
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    // Verify pollRemoteFftFrame can read the analyser after loadRemoteStream.
    const { pollRemoteFftFrame } = await import('./remotePlayer');
    const track = {
      id: 'non-linux-web-audio', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'non-linux', streamUrl: 'http://127.0.0.1:8765/proxy?non-linux',
    } as Track;

    try {
      visualizerReactivity.set(0.5);
      await loadRemoteStream(track, track.streamUrl!);
      setRemoteVolume(40);

      expect(createMediaElementSource).toHaveBeenCalledWith(getAudioElement());
      expect(gain.gain.value).toBeCloseTo(0.4);
      expect(getAudioElement()?.volume).toBe(1);
      // Call pollRemoteFftFrame directly — the visualizers call this at the
      // start of renderFrame to drive FFT reads inside their own rAF loop.
      pollRemoteFftFrame();
      expect(analyser.getByteFrequencyData).toHaveBeenCalled();
      expect(analyser.smoothingTimeConstant).toBeCloseTo(0.92);

      visualizerReactivity.set(2);
      expect(analyser.smoothingTimeConstant).toBeCloseTo(0.45);
    } finally {
      visualizerReactivity.set(1);
      window.AudioContext = OriginalAudioContext;
      userAgent.mockRestore();
      play.mockRestore();
    }
  });

  it('reports a failed HTMLAudio playback once without changing the fallback behavior', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('private browser error'));
    const track = {
      id: 'remote-audio-test', title: 'Private title', artist: 'Private artist', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'private-source', streamUrl: 'http://127.0.0.1:8765/proxy?private',
    } as Track;

    await loadRemoteStream(track, track.streamUrl!);

    expect(reportRemoteAudioPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackFailure).toHaveBeenCalledWith(expect.any(Number));
    expect(get(remoteActive)).toBe(false);
    play.mockRestore();
  });

  it('records one successful remote playback outcome after HTMLAudio starts', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const track = {
      id: 'remote-audio-success', title: 'Private title', artist: 'Private artist', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'private-source', streamUrl: 'http://127.0.0.1:8765/proxy?private',
    } as Track;

    await loadRemoteStream(track, track.streamUrl!);

    expect(reportRemoteAudioPlaybackSuccess).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackSuccess).toHaveBeenCalledWith(expect.any(Number));
    expect(reportRemoteAudioPlaybackFailure).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('records one failed outcome when play rejection and media error race', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('private browser error'));
    const track = {
      id: 'remote-audio-race', title: 'Private title', artist: 'Private artist', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'private-source', streamUrl: 'http://127.0.0.1:8765/proxy?private',
    } as Track;

    const loading = loadRemoteStream(track, track.streamUrl!);
    getAudioElement()?.dispatchEvent(new Event('error'));
    await loading;

    expect(reportRemoteAudioPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackSuccess).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('records a post-start HTMLAudio error as one separate runtime failure', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const track = { id: 'runtime-error', title: '', artist: '', album: '', duration: 0, source: Source.SoundCloud, sourceId: 'id', streamUrl: 'http://127.0.0.1:8765/proxy?runtime' } as Track;

    await loadRemoteStream(track, track.streamUrl!);
    getAudioElement()?.dispatchEvent(new Event('error'));
    getAudioElement()?.dispatchEvent(new Event('error'));

    expect(reportRemoteAudioPlaybackSuccess).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackRuntimeFailure).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  it('re-resolves once on MEDIA_ERR_NETWORK and reloads without runtime failure', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.mocked(reResolveStream).mockResolvedValue({
      streamUrl: 'http://127.0.0.1:8765/proxy?fresh',
      proxyCapability: 'cap',
    });
    const track = { id: 'recover', title: '', artist: '', album: '', duration: 0, source: Source.SoundCloud, sourceId: 'id', streamUrl: 'http://127.0.0.1:8765/proxy?stale' } as Track;

    await loadRemoteStream(track, track.streamUrl!, undefined, undefined, 7);
    const audio = getAudioElement()!;
    Object.defineProperty(audio, 'error', { value: { code: 2 }, configurable: true });
    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));

    expect(reResolveStream).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackRuntimeFailure).not.toHaveBeenCalled();

    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(reportRemoteAudioPlaybackRuntimeFailure).toHaveBeenCalledTimes(1));
    expect(reResolveStream).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  it('restores position and paused intent after a one-shot URL refresh', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.mocked(reResolveStream).mockResolvedValue({ streamUrl: 'http://127.0.0.1:8765/proxy?fresh' });
    const track = { id: 'recover-position', title: '', artist: '', album: '', duration: 120, source: Source.SoundCloud, sourceId: 'id', streamUrl: 'http://127.0.0.1:8765/proxy?stale' } as Track;

    await loadRemoteStream(track, track.streamUrl!, undefined, undefined, 9);
    const audio = getAudioElement()!;
    audio.currentTime = 42;
    Object.defineProperty(audio, 'error', { value: { code: 2 }, configurable: true });
    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(audio.currentTime).toBe(42);
    expect(pause).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });

  it('restores playing intent after a one-shot URL refresh', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.mocked(reResolveStream).mockResolvedValue({ streamUrl: 'http://127.0.0.1:8765/proxy?fresh-playing' });
    const track = { id: 'recover-playing', title: '', artist: '', album: '', duration: 120, source: Source.SoundCloud, sourceId: 'id', streamUrl: 'http://127.0.0.1:8765/proxy?stale' } as Track;

    await loadRemoteStream(track, track.streamUrl!, undefined, undefined, 10);
    const audio = getAudioElement()!;
    audio.currentTime = 55;
    isPlaying.set(true);
    Object.defineProperty(audio, 'error', { value: { code: 2 }, configurable: true });
    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(audio.currentTime).toBe(55);
    expect(play).toHaveBeenCalledTimes(3);
    isPlaying.set(false);
    play.mockRestore();
  });

  it('reports runtime failure when MEDIA_ERR_SRC_NOT_SUPPORTED re-resolve fails', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.mocked(reResolveStream).mockRejectedValue(new Error('resolve failed'));
    const track = { id: 'recover-fail', title: '', artist: '', album: '', duration: 0, source: Source.SoundCloud, sourceId: 'id', streamUrl: 'http://127.0.0.1:8765/proxy?stale' } as Track;

    await loadRemoteStream(track, track.streamUrl!, undefined, undefined, 8);
    const audio = getAudioElement()!;
    Object.defineProperty(audio, 'error', { value: { code: 4 }, configurable: true });
    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(reportRemoteAudioPlaybackRuntimeFailure).toHaveBeenCalledTimes(1));

    expect(reResolveStream).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  it('ignores stale rejected callbacks from an overlapping playback attempt', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let rejectFirst!: (error: Error) => void;
    const firstPlay = new Promise<void>((_, reject) => { rejectFirst = reject; });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockReturnValueOnce(firstPlay)
      .mockResolvedValueOnce(undefined);
    const first = { id: 'first', title: '', artist: '', album: '', duration: 0, source: Source.SoundCloud, sourceId: 'first', streamUrl: 'http://127.0.0.1:8765/proxy?first' } as Track;
    const second = { ...first, id: 'second', sourceId: 'second', streamUrl: 'http://127.0.0.1:8765/proxy?second' };

    const staleLoad = loadRemoteStream(first, first.streamUrl!);
    await loadRemoteStream(second, second.streamUrl!);
    rejectFirst(new Error('stale private error'));
    await staleLoad;

    expect(reportRemoteAudioPlaybackSuccess).toHaveBeenCalledTimes(1);
    expect(reportRemoteAudioPlaybackFailure).not.toHaveBeenCalled();
    expect(reportRemoteAudioPlaybackRuntimeFailure).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('does not restore remote state when a stale play fulfillment follows a newer failure', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let resolveFirst!: () => void;
    const firstPlay = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockReturnValueOnce(firstPlay)
      .mockRejectedValueOnce(new Error('newer failure'));
    const first = { id: 'same-track', title: '', artist: '', album: '', duration: 0, source: Source.SoundCloud, sourceId: 'same-track', streamUrl: 'http://127.0.0.1:8765/proxy?first' } as Track;
    const second = { ...first, streamUrl: 'http://127.0.0.1:8765/proxy?second' };

    const staleLoad = loadRemoteStream(first, first.streamUrl!);
    await loadRemoteStream(second, second.streamUrl!);
    resolveFirst();
    await staleLoad;

    expect(get(remoteActive)).toBe(false);
    expect(reportRemoteAudioPlaybackSuccess).not.toHaveBeenCalled();
    play.mockRestore();
  });
});

describe('remotePlayer store > AppError extraction in play() rejection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a structured AppError code+details, not [object Object]', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    // play() rejects with a structured AppError object, not an Error instance.
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue({
      code: 'PLAYBACK_ERROR',
      details: 'codec not supported',
    });
    const track = {
      id: 'apperror-test', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'src', streamUrl: 'http://127.0.0.1:8765/proxy?apperror',
    } as Track;

    const { notifications } = await import('@shared/stores/notifications');
    const pushSpy = notifications.push as ReturnType<typeof vi.fn>;

    await loadRemoteStream(track, track.streamUrl!);

    const errorCall = pushSpy.mock.calls.find((c) => c[0]?.type === 'error');
    expect(errorCall).toBeTruthy();
    expect(errorCall![0].message).not.toBe('[object Object]');
    expect(errorCall![0].message).toBe('codec not supported');
    expect(get(remoteActive)).toBe(false);
    play.mockRestore();
  });

  it('extracts a standard Error instance .message from play() rejection', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('autoplay blocked'));
    const track = {
      id: 'error-instance-test', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'src', streamUrl: 'http://127.0.0.1:8765/proxy?errinst',
    } as Track;

    const { notifications } = await import('@shared/stores/notifications');
    const pushSpy = notifications.push as ReturnType<typeof vi.fn>;

    await loadRemoteStream(track, track.streamUrl!);

    const errorCall = pushSpy.mock.calls.find((c) => c[0]?.type === 'error');
    expect(errorCall).toBeTruthy();
    expect(errorCall![0].message).toBe('autoplay blocked');
    expect(errorCall![0].message).not.toBe('[object Object]');
    play.mockRestore();
  });
});

describe('remotePlayer store > Linux cloned-element FFT tap', () => {
  function installLinuxAudioContextWithAnalyser(getByteData: (bins: Uint8Array) => void) {
    const connect = vi.fn();
    const gain = { gain: { value: 0 }, connect };
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 512,
      connect,
      getByteFrequencyData: vi.fn((bins: Uint8Array) => getByteData(bins)),
    };
    const createMediaElementSource = vi.fn((_el: HTMLAudioElement) => ({ connect }));
    const context = {
      state: 'running',
      sampleRate: 48_000,
      destination: {},
      createMediaElementSource,
      createGain: vi.fn(() => gain),
      createAnalyser: vi.fn(() => analyser),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const Original = window.AudioContext;
    window.AudioContext = function () { return context as unknown as AudioContext; } as unknown as typeof AudioContext;
    return {
      restore: () => { window.AudioContext = Original; },
      analyser,
      createMediaElementSource,
    };
  }

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Jellyx WebKitGTK Linux');
    stopRemote();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes non-zero remote FFT frames from the Linux clone tap to the store', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { analyser } = installLinuxAudioContextWithAnalyser((bins) => {
      for (let i = 0; i < bins.length; i++) bins[i] = (i % 64) * 4;
    });
    const { frequencyData, selectFftSource } = await import('./player');
    const { pollRemoteFftFrame } = await import('./remotePlayer');
    selectFftSource('remote');
    const track = {
      id: 'linux-fft', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'linux-fft', streamUrl: 'http://127.0.0.1:8765/proxy?linux-fft',
    } as Track;

    try {
      await loadRemoteStream(track, track.streamUrl!);
      expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
      // Call pollRemoteFftFrame directly — the visualizers call this at the
      // start of renderFrame to drive FFT reads inside their rAF loop.
      pollRemoteFftFrame();
      await Promise.resolve();

      const frame = get(frequencyData) as { bins: Float32Array; peak: number; sampleRate: number } | null;
      expect(frame).not.toBeNull();
      expect(frame!.bins).toBeInstanceOf(Float32Array);
      expect(frame!.bins.length).toBe(512);
      // Non-zero: the analyser mock fills bins with (i % 64) * 4 / 255 > 0.
      const nonZero = Array.from(frame!.bins).filter((v) => v > 0).length;
      expect(nonZero).toBeGreaterThan(0);
      expect(frame!.peak).toBeGreaterThan(0);
      expect(frame!.sampleRate).toBe(48_000);
    } finally {
      play.mockRestore();
    }
  });

  it('analyses the clone, never the primary element, on Linux', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { createMediaElementSource } = installLinuxAudioContextWithAnalyser(() => {});
    const track = {
      id: 'linux-clone-target', title: '', artist: '', album: '', duration: 0,
      source: Source.SoundCloud, sourceId: 'linux-clone', streamUrl: 'http://127.0.0.1:8765/proxy?linux-clone',
    } as Track;

    try {
      await loadRemoteStream(track, track.streamUrl!);
      expect(createMediaElementSource).toHaveBeenCalledTimes(1);
      const analysed = createMediaElementSource.mock.calls[0][0] as unknown as HTMLAudioElement;
      expect(analysed).not.toBe(getAudioElement());
      // The analysed element is a separate, muted node appended to the DOM.
      expect(analysed.muted).toBe(true);
    } finally {
      play.mockRestore();
    }
  });

  it('keeps the clone src in sync with the primary across the YouTube cache swap', async () => {
    vi.mocked(cacheRemoteStream).mockResolvedValue('/tmp/cached.m4a');
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    installLinuxAudioContextWithAnalyser(() => {});
    const track = {
      id: 'linux-yt-swap', title: '', artist: '', album: '', duration: 120,
      source: Source.YouTube, sourceId: 'linux-yt', streamUrl: 'http://127.0.0.1:8765/proxy?linux-yt',
    } as Track;

    try {
      await loadRemoteStream(track, track.streamUrl!, 'https://youtu.be/linux-yt', 'cap', 0);
      const audio = getAudioElement()!;
      // After a successful swap the primary src points at the cached local file
      // served through the proxy; the clone must follow.
      await vi.waitFor(() => expect(audio.src).toContain('file%3A%2F%2F'));
      // The clone is tracked via createMediaElementSource's first arg.
      // Its src should match the primary's post-swap src.
      const clone = document.querySelector('audio[aria-hidden="true"]') as HTMLAudioElement | null;
      expect(clone).not.toBeNull();
      expect(clone!.src).toBe(audio.src);
    } finally {
      vi.mocked(cacheRemoteStream).mockReset();
      play.mockRestore();
    }
  });
});
