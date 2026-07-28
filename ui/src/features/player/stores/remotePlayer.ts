/**
 * Remote player store — manages frontend browser-native audio playback
 * for remote tracks (YouTube, SoundCloud, etc.) via HTMLAudioElement.
 *
 * This is the browser-side companion to the Rust proxy server.
 * When Rust emits `stream-resolved`, the frontend loads the proxied URL
 * into an HTMLAudio element and drives play/pause/seek natively.
 *
 * For YouTube tracks, the frontend calls `cache_remote_stream` to download
 * the stream to a local file for instant seeking. The local file is routed
 * back through the proxy (`file://` via the proxy) instead of
 * `convertFileSrc` (asset://) so the Web Audio AnalyserNode stays
 * CORS-un-tainted and keeps producing real frequency data for Modo Cine.
 * SoundCloud stays on the remote proxy path (its seek already works fine
 * over HTTP Range requests).
 *
 * A Web Audio AnalyserNode is bound to the audio element once and kept
 * alive across tracks; a setTimeout-based polling loop publishes
 * FrequencyData to the same `frequencyData` store the local Rust FFT path
 * uses, so the visualizer works uniformly regardless of source.
 *
 * Local tracks still use the Rust Symphonia/cpal pipeline (and the Rust
 * FFT engine), which is untouched here.
 */

import { writable, get } from 'svelte/store';
import {
  progress,
  isPlaying,
  currentTrack,
  volume,
  nextTrack,
  normalizeAudio,
  publishFftFrame,
  selectFftSource,
  clearFftSource,
  visualizerReactivity,
} from './player';
import { reactivityToSmoothing } from './visualizerSettings';
import { skipToNext } from './player';
import { notifications } from '@shared/stores/notifications';
import { t } from '@i18n';
import {
  cacheRemoteStream,
  prefetchNextStream,
  reResolveStream,
  reportRemoteAudioPlaybackFailure,
  reportRemoteAudioPlaybackRuntimeFailure,
  reportRemoteAudioPlaybackSuccess,
  startRemoteFft,
} from '@services/commands';
import { convertFileSrc } from '@tauri-apps/api/core';
import { extractErrorMessage } from '@shared/utils/errors';
import type { Track, FrequencyData } from '@shared/types/models';
import { Source } from '@shared/types/models';

/** The underlying HTMLAudio element for remote playback. */
let audioEl: HTMLAudioElement | null = null;

// ── Remote Web Audio FFT (AnalyserNode) ─────────────────────────────
// Remote tracks (YouTube, SoundCloud) bypass the Rust Symphonia/cpal
// pipeline and therefore have no Rust FFT. We attach a Web Audio API
// AnalyserNode to the HTMLAudioElement and run a requestAnimationFrame
// loop that publishes FrequencyData to the same `frequencyData` store
// the local path uses, so Modo Cine / the visualizer works uniformly.
//
// CORS note (the lesson from the earlier rollback):
// `createMediaElementSource` permanently "taints" the element if the
// source is not CORS-compliant, after which getFloatFrequencyData
// returns all zeros. The local proxy already responds with
// `Access-Control-Allow-Origin: *` on both the remote-forward path and
// the `file://` local-cache path. To keep analysis working across the
// YouTube local-cache swap, we set `audioEl.crossOrigin = 'anonymous'`
// up front and route cached local files through the proxy (`file://`
// via the proxy) instead of `convertFileSrc` (asset://), which is not
// CORS-compliant. This is a minimal, opt-in change: local playback
// (Symphonia/cpal) is untouched.

/** Web Audio context kept alive across tracks (never closed on stop). */
let audioCtx: AudioContext | null = null;
/** Media element source bound to the analysed element. Created ONCE per element lifetime. */
let mediaSource: MediaElementAudioSourceNode | null = null;
/** The element mediaSource is bound to (primary on non-Linux, clone on Linux).
 *  Used by stopRemote to decide whether to tear down the chain (clone) or keep
 *  it alive across tracks (primary — createMediaElementSource is one-shot). */
let mediaSourceBoundEl: HTMLAudioElement | null = null;
/** Gain node for remote playback volume/mute when routed through Web Audio. */
let gainNode: GainNode | null = null;
/** Analyser node used for frequency-bin extraction. */
let analyser: AnalyserNode | null = null;
/** Reactivity subscription exists only when the Web Audio chain exists. */
let unsubscribeAnalyserSmoothing: (() => void) | null = null;
/** Guard flag: reset via queueMicrotask after each rAF batch. Ensures
 *  pollRemoteFftFrame reads the analyser at most ONCE per visual frame,
 *  even when multiple visualizers call it in the same rAF batch. */
let fftFrameGuard = false;
/** Reusable byte buffer for analyser.getByteFrequencyData (Uint8Array bins).
 *  Typed as `Uint8Array<ArrayBuffer>` to match the narrower lib.dom signature. */
let fftByteBins: Uint8Array<ArrayBuffer> | null = null;
/** Reusable Float32Array for publishing to the frequencyData store. */
let fftFloatBins: Float32Array | null = null;

// ── Linux/WebKitGTK cloned-element FFT tap ──────────────────────────
// On Linux/WebKitGTK, `createMediaElementSource(audioEl)` reroutes the
// element's output exclusively into the Web Audio graph and SILENCES the
// element's native <audio> output. A prior fix (#1461) restored audibility
// by bypassing the Web Audio graph entirely for remote playback on Linux,
// which also zeroed out remote FFT/visualizer data.
//
// To keep BOTH audible remote audio AND working remote visualizers on
// Linux, we keep the primary `audioEl` on its native direct-output path
// (audible) and analyse a SEPARATE hidden cloned <audio> element that
// shares the same proxied `src`. The clone is routed through
// `createMediaElementSource` → `AnalyserNode` and is NOT connected to
// `audioCtx.destination`, so it produces no sound of its own — it only
// feeds the analyser. Play/pause and currentTime are synced from the
// primary element so the analyser sees the same audio the user hears.
//
// The clone is created lazily on first Linux remote load and reused for
// the element's lifetime. Each new track updates the clone's `src`
// alongside the primary's.

/** Hidden cloned <audio> used ONLY for FFT analysis on Linux/WebKitGTK.
 *  null on non-Linux platforms and before the first Linux remote load. */
let analyserAudioEl: HTMLAudioElement | null = null;
/** Whether the cloned-element tap has been bound to a MediaElementSource. */
let analyserCloneBound = false;
/** Syncs play/pause + currentTime from the primary element to the clone. */
let cloneSyncUnlisten: (() => void) | null = null;

/** FFT size for the remote AnalyserNode. Must be a power of two; 1024
 *  matches the Rust FftEngine size used for local playback so the
 *  visualizer sees the same bin count regardless of source. */
const REMOTE_FFT_SIZE = 1024;

/** Parse the proxy port from a proxied stream URL. */
function parseProxyPort(url: string): number | null {
  const m = url.match(/^https?:\/\/127\.0\.0\.1:(\d+)\/proxy\?/);
  return m ? Number(m[1]) : null;
}

/** Build a proxy-routed URL for a local file path so the cached YouTube
 *  m4a is served with CORS headers (the proxy injects
 *  `Access-Control-Allow-Origin: *`). Falls back to `convertFileSrc`
 *  (asset://) when the proxy port cannot be derived — in that case the
 *  AnalyserNode simply won't produce real data for the cached file, but
 *  playback still works (mirrors pre-FFT behavior). */
export function proxyLocalUrl(port: number | null, capability: string | undefined, path: string): string {
  if (port == null || !capability) return convertFileSrc(path);
  // Encode the file:// URL the same way the Rust proxy expects it.
  const fileUrl = `file://${path}`;
  return `http://127.0.0.1:${port}/proxy?cap=${encodeURIComponent(capability)}&url=${encodeURIComponent(fileUrl)}`;
}

/** Set up the Linux/WebKitGTK analysis tap: create (once) a hidden cloned
 *  <audio> sharing the primary element's src, bind it to a
 *  MediaElementSource → AnalyserNode NOT connected to destination, and
 *  wire play/pause + currentTime sync from the primary to the clone.
 *
 *  The primary element keeps its native direct output (audible); the clone
 *  only feeds the analyser (inaudible). Safe to call on every Linux remote
 *  load — the clone + Web Audio chain are created once and reused.
 *
 *  IMPORTANT: `preferredSrc`, when provided, is set on the clone BEFORE
 *  creating the Web Audio chain. This is critical on WebKitGTK, where
 *  `createMediaElementSource(clone)` requires the element to already have
 *  a valid src — calling it with an empty src produces a broken
 *  MediaElementSource that never feeds the AnalyserNode. */
function ensureLinuxAnalyserTap(primary: HTMLAudioElement, preferredSrc?: string): void {
  const clone = ensureAnalyserClone(primary);
  if (!clone) return;
  // Prefer the explicit URL when provided (playStream sets this from the
  // computed playable URL before the primary's android.src gets it).
  // Otherwise sync from the primary, but ONLY when primary.src is non-empty
  // — copying an empty src would wipe the clone's loaded source.
  if (preferredSrc && clone.src !== preferredSrc) {
    clone.src = preferredSrc;
  } else if (primary.src && clone.src !== primary.src) {
    clone.src = primary.src;
  }
  if (!analyserCloneBound) {
    // Build the Web Audio chain on the clone. connectToDestination=false
    // so the clone produces no sound; the primary element is audible.
    ensureWebAudioChain(clone, false);
    analyserCloneBound = mediaSource != null;
  }
  if (analyserCloneBound) {
    attachCloneSync(primary, clone);
  }
}

/** Lazily create the AudioContext + MediaElementSource + AnalyserNode.
 *  `createMediaElementSource` can only be called ONCE per element —
 *  after that the source is permanently bound — so we create the chain
 *  on the first track and keep it alive for the element's lifetime.
 *
 *  `el` is the element to analyse: the primary `audioEl` on non-Linux
 *  (also routed to `destination` for audible Web Audio output), or the
 *  hidden cloned analysis element on Linux (NOT routed to `destination`
 *  — the primary element provides audible direct output, the clone only
 *  feeds the analyser). */
function ensureWebAudioChain(el: HTMLAudioElement, connectToDestination: boolean): void {
  if (mediaSource && mediaSourceBoundEl === el) return; // already bound to THIS element
  if (mediaSource && mediaSourceBoundEl !== el) {
    // Bound to a different element (e.g. a previous clone, or a platform
    // switch in tests). Tear down the stale chain before rebinding.
    unsubscribeAnalyserSmoothing?.();
    unsubscribeAnalyserSmoothing = null;
    if (audioCtx && typeof audioCtx.close === 'function') { audioCtx.close().catch(() => {}); }
    audioCtx = null;
    mediaSource = null;
    mediaSourceBoundEl = null;
    gainNode = null;
    analyser = null;
    fftByteBins = null;
    fftFloatBins = null;
    analyserCloneBound = false;
  }
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return; // WebKitGTK without Web Audio — gracefully no-op
  audioCtx = new Ctx();
  try {
    mediaSource = audioCtx.createMediaElementSource(el);
    mediaSourceBoundEl = el;
  } catch {
    // Source may already be bound (HMR edge case) — bail out safely.
    mediaSource = null;
    audioCtx = null;
    return;
  }
  gainNode = audioCtx.createGain();
  // On Linux the clone's gainNode only feeds the analyser (not destination),
  // so keep it at unity so the visualizer sees the true signal regardless of
  // the user's volume setting. On non-Linux the gainNode also drives audible
  // output, so initialise it to the current volume.
  gainNode.gain.value = connectToDestination ? Math.max(0, Math.min(1, get(volume) / 100)) : 1;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = REMOTE_FFT_SIZE;
  unsubscribeAnalyserSmoothing?.();
  // Reactivity slider controls AnalyserNode smoothing on ALL platforms.
  // Previously Linux was hardcoded to 0, but the proxy FFT proved unreliable
  // (2-3s latency behind playback), so the AnalyserNode is the primary FFT
  // source for remote streams and needs proper smoothing.
  unsubscribeAnalyserSmoothing = visualizerReactivity.subscribe((reactivity) => {
    if (analyser) analyser.smoothingTimeConstant = reactivityToSmoothing(reactivity);
  });
  mediaSource.connect(gainNode);
  gainNode.connect(analyser);
  // On Linux the clone must NOT be connected to destination — the primary
  // element already produces audible direct output, and connecting the
  // clone would double the audio. On non-Linux the primary element IS
  // the analysed element and MUST be connected to destination to be heard.
  if (connectToDestination) {
    analyser.connect(audioCtx.destination);
  } else {
    // Linux clone: connect analyser → silentGain(0) → destination.
    // WebKitGTK does NOT process a Web Audio graph that has no path to
    // destination — the AnalyserNode would receive stale or zero data.
    // A zero-gain node keeps the graph alive (data flows through) without
    // producing any audible output, so the clone stays inaudible while
    // the AnalyserNode gets real-time frequency data.
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    analyser.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  }
  // Pre-allocate reusable buffers (half the FFT size = Nyquist bins).
  fftByteBins = new Uint8Array(analyser.frequencyBinCount);
  fftFloatBins = new Float32Array(analyser.frequencyBinCount);
}

/** Lazily create the hidden cloned <audio> used for FFT analysis on
 *  Linux/WebKitGTK. The clone shares the primary element's src and
 *  crossOrigin so it sees the same CORS-un-tainted proxied stream. */
function ensureAnalyserClone(primary: HTMLAudioElement): HTMLAudioElement | null {
  if (analyserAudioEl) return analyserAudioEl;
  const clone = document.createElement('audio');
  clone.preload = 'auto';
  clone.crossOrigin = 'anonymous';
  // The clone is never connected to destination, so it is inaudible.
  // Muting it as a belt-and-suspenders guard against any environment that
  // somehow routes a cloned media element to the default output.
  clone.muted = true;
  // Keep the clone out of the layout and a11y tree.
  clone.setAttribute('aria-hidden', 'true');
  clone.style.position = 'fixed';
  clone.style.width = '0';
  clone.style.height = '0';
  clone.style.opacity = '0';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);
  analyserAudioEl = clone;
  return clone;
}

/** Sync play/pause + currentTime from the primary audio element to the
 *  Linux analysis clone so the analyser inspects the same audio the user
 *  hears. Idempotent: safe to call multiple times (only the latest
 *  listener set is kept).
 *
 *  IMPORTANT: this function does NOT use periodic timers or playbackRate
 *  adjustments. On WebKitGTK, accessing `currentTime` or `playbackRate`
 *  on a playing <audio> element can trigger a synchronous IPC to the
 *  GStreamer pipeline, blocking the main thread for 10-100+ ms. A
 *  periodic timer (setInterval + smoothSync) was found to drop rAF
 *  frame rate from 60fps to 6-15fps.
 *
 *  Instead, we only sync on explicit events (play, pause, seeked,
 *  canplay) — these are naturally rate-limited by the user's actions
 *  and the stream lifecycle. The clone may drift a few hundred ms over
 *  several minutes, but the visualizer stays smooth because the
 *  AnalyserNode buffer is never starved. */
function attachCloneSync(primary: HTMLAudioElement, clone: HTMLAudioElement): void {
  cloneSyncUnlisten?.();

  /** Hard-seek the clone to the primary's position. Only called on deliberate
   *  seeks (user seek, track change, clone source load). */
  const hardSync = () => {
    try { clone.currentTime = primary.currentTime; } catch { /* not seekable yet */ }
  };

  const onPlay = () => {
    void clone.play().catch(() => {});
    hardSync();                     // align on start
  };
  const onPause = () => { clone.pause(); };
  // User seek → must hard-seek the clone (AnalyserNode flush unavoidable).
  const onSeeked = () => { hardSync(); };
  // New source loaded (track change, cache swap) → hard sync once.
  const onCanPlay = () => {
    if (!clone.paused) return;
    void clone.play().catch(() => {});
    hardSync();
  };
  primary.addEventListener('play', onPlay);
  primary.addEventListener('pause', onPause);
  primary.addEventListener('seeked', onSeeked);
  clone.addEventListener('canplay', onCanPlay);
  cloneSyncUnlisten = () => {
    primary.removeEventListener('play', onPlay);
    primary.removeEventListener('pause', onPause);
    primary.removeEventListener('seeked', onSeeked);
    clone.removeEventListener('canplay', onCanPlay);
  };
}

/** Reusable publish object to avoid per-frame object allocation. */
const remotePublishFrame: FrequencyData = {
  bins: new Float32Array(0),
  sampleRate: 0,
  peak: 0,
};

/** Poll the remote AnalyserNode once and publish to the frequencyData store.
 *
 *  Called from each visualizer's rAF loop (MiniVisualizer, NowPlayingVisualizer,
 *  Visualizer) at the start of renderFrame. A per-rAF-batch guard ensures the
 *  analyser is read at MOST ONCE per visual frame, even when multiple visualizers
 *  share the same rAF batch. The visualizer that calls first reads the analyser;
 *  the others get the just-published data from the shared store.
 *
 *  No-op when the analyser isn't ready or when the frame was already polled. */
export function pollRemoteFftFrame(): void {
  if (!analyser || !fftByteBins || !fftFloatBins) return;
  if (document.hidden) return;
  // Guard: only one analyser read per rAF batch.
  if (fftFrameGuard) return;
  fftFrameGuard = true;
  // Reset the guard after this turn's microtasks complete.
  queueMicrotask(() => { fftFrameGuard = false; });

  analyser.getByteFrequencyData(fftByteBins);
  let peak = 0;
  for (let i = 0; i < fftByteBins.length; i++) {
    const v = fftByteBins[i] / 255;
    fftFloatBins[i] = v;
    if (v > peak) peak = v;
  }
  remotePublishFrame.bins = fftFloatBins;
  remotePublishFrame.sampleRate = audioCtx?.sampleRate ?? 44100;
  remotePublishFrame.peak = peak;
  publishFftFrame('remote', remotePublishFrame);
}

/** Resume the AudioContext if it was suspended (autoplay policy / WebKit
 *  requiring a user gesture). Safe to call repeatedly.
 *
 *  WebKitGTK starts a fresh AudioContext in the `suspended` state and will
 *  only move it to `running` from within a user-gesture call stack. When
 *  `loadRemoteStream()` runs outside a gesture (e.g. an auto-advanced queue
 *  or a programmatic `nextTrack()`), the initial `resumeAudioCtx()` call
 *  silently no-ops and the AnalyserNode keeps producing all-zero bins.
 *
 *  Any genuine user gesture that should light up Modo Cine — the Modo Cine
 *  button click — MUST call this so the suspended context finally resumes
 *  and `frequencyData` starts carrying real magnitudes. */
export function resumeRemoteAudioCtx(): void {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      // Autoplay gesture not yet received — loop will start producing
      // data once the context is resumed by a later user interaction.
    });
  }
}

/** Internal alias kept for the existing `loadRemoteStream` / `resumeRemote`
 *  call sites. Delegates to the public function. */
function resumeAudioCtx(): void {
  resumeRemoteAudioCtx();
}

/** Whether normalization is currently active (read-only flag for UI). */
let normalizationActive = false;

/** The current stream URL - stored for diagnostics. Survives HMR. */
let currentStreamUrl = '';

/** The original proxied stream URL. Kept as fallback if local-cache download fails. */
let baseStreamUrl = '';

/** The source of the current track (YouTube, SoundCloud, Local). */
let currentSource = '';

/** Known duration of the current track (from yt-dlp metadata), used as fallback
 *  when HTMLAudioElement.duration returns Infinity (common with YouTube m4a). */
let trackDuration = 0;

/** Absolute offset represented by the start of the currently loaded stream.
 *  Always 0 now — YouTube seek uses native `currentTime` again, so the element's
 *  currentTime is always absolute. Kept for the timeupdate handler so a future
 *  partial-stream approach can be reintroduced without touching that handler. */
let streamOffset = 0;

/** Whether a seek is in progress — suppresses error handling for aborts. */
let seeking = false;

/** When true, suppresses 'error' events from the audio element that are
 *  caused by intentionally clearing the source (stopRemote). Without this,
 *  setting audio.src = '' fires a MEDIA_ERR_SRC_NOT_SUPPORTED that triggers
 *  error notifications and skipToNext loops. */
let intentionallyStopping = false;
/** Whether audio was playing before the seek started — used to resume after seek. */
let wasPlayingBeforeSeek = false;

/** Telemetry state belongs to the attempt captured by its browser callbacks. */
interface RemotePlaybackAttempt {
  readonly generation: number;
  readonly startedAt: number;
  sourceUrl: string;
  startReported: boolean;
  runtimeReported: boolean;
  reResolving: boolean;
}

interface RecoveryPlaybackState {
  position: number;
  shouldPlay: boolean;
}

let remotePlaybackGeneration = 0;
let activeRemotePlaybackAttempt: RemotePlaybackAttempt | null = null;
let removeAttemptErrorHandler: (() => void) | null = null;

function isCurrentAttempt(attempt: RemotePlaybackAttempt, audio: HTMLAudioElement): boolean {
  return activeRemotePlaybackAttempt?.generation === attempt.generation && audio.src === attempt.sourceUrl;
}

function reportAttemptOutcome(attempt: RemotePlaybackAttempt, runtime: boolean, succeeded: boolean): void {
  if ((runtime && attempt.runtimeReported) || (!runtime && attempt.startReported)) return;
  if (runtime) attempt.runtimeReported = true;
  else attempt.startReported = true;
  const elapsedMs = Math.max(0, Math.min(60_000, Math.round(performance.now() - attempt.startedAt)));
  const report = runtime
    ? (succeeded ? reportRemoteAudioPlaybackSuccess : reportRemoteAudioPlaybackRuntimeFailure)
    : (succeeded ? reportRemoteAudioPlaybackSuccess : reportRemoteAudioPlaybackFailure);
  void report(elapsedMs).catch(() => {
    // Observability must never alter the existing fallback/skip behavior.
  });
}

function installAttemptErrorHandler(
  audio: HTMLAudioElement,
  attempt: RemotePlaybackAttempt,
  track: Track,
  streamRequestId: number,
): void {
  removeAttemptErrorHandler?.();
  const onError = async (e: Event) => {
    if (!isCurrentAttempt(attempt, audio)) return;
    const target = e.target as HTMLAudioElement;
    const errorCode = target.error?.code;

    if (seeking || swappingSource || intentionallyStopping) return;

    const mayBeExpiredUrl = errorCode === 2 || errorCode === 4;
    if (mayBeExpiredUrl && !attempt.reResolving) {
      attempt.reResolving = true;
      const recoveryState: RecoveryPlaybackState = {
        position: Number.isFinite(target.currentTime) ? target.currentTime : 0,
        shouldPlay: !target.paused || get(isPlaying),
      };
      try {
        const fresh = await reResolveStream(track, streamRequestId);
        if (!isCurrentAttempt(attempt, audio)) return;
        if (fresh.streamUrl) {
          await loadRemoteStreamAttempt(
            track,
            fresh.streamUrl,
            undefined,
            fresh.proxyCapability,
            streamRequestId,
            true,
            recoveryState,
          );
          return;
        }
      } catch {
        // Fall through to the existing failure telemetry and skip behavior.
      }
    }

    // An error before play() settles is a start failure; a later error is a
    // separate runtime outcome and must remain visible after a successful start.
    reportAttemptOutcome(attempt, attempt.startReported, false);

    const translate = get(t);
    let message = translate('playback.error_title', { default: 'Remote playback failed' });
    switch (errorCode) {
      case 1: // MEDIA_ERR_ABORTED
        message = translate('playback.aborted', { default: 'Playback aborted' });
        break;
      case 2: // MEDIA_ERR_NETWORK
        message = translate('playback.network_error', { default: 'Network error during playback' });
        break;
      case 3: // MEDIA_ERR_DECODE
        message = translate('playback.decode_error', { default: 'Audio decoding error' });
        break;
      case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
        message = translate('playback.format_not_supported', { default: 'Audio format not supported' });
        break;
    }
    notifications.push({ type: 'error', title: translate('playback.error_title', { default: 'Playback Error' }), message, dismissible: true });
    isPlaying.set(false);
    remoteActive.set(false);
    skipToNext();
  };
  audio.addEventListener('error', onError);
  removeAttemptErrorHandler = () => audio.removeEventListener('error', onError);
}

/** Whether a source swap (cache → local file) is in progress — suppresses errors. */
let swappingSource = false;

/** Monotonic id for seek attempts — prevents stale callbacks from older seeks
 *  from mutating state during a newer seek. */
let seekToken = 0;

/** Whether a remote track is currently loaded. */
export const remoteActive = writable(false);

/** Whether a YouTube local-cache download is in progress. */
export const cachingStream = writable(false);

/** Add a local-proxy query parameter without mutating the encoded upstream URL. */
function appendProxyParam(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/** Create or reuse an HTMLAudio element. */
function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
    // crossOrigin='anonymous' is REQUIRED for the AnalyserNode to see
    // real data. The proxy already responds with
    // `Access-Control-Allow-Origin: *` on both the remote-forward path
    // and the file:// local-cache path, so all remote sources are
    // CORS-compliant when routed through the proxy. This MUST be set
    // before any src is assigned, otherwise the element is tainted and
    // getByteFrequencyData returns all zeros.
    audioEl.crossOrigin = 'anonymous';

    // Prefetch state for the remote audio element. Reset on each new track load
    // via `loadRemoteStream` below.
    let prefetchedNext = false;

    // Sync timeupdate → progress store, and drive MSE segment prefetching
    audioEl.addEventListener('timeupdate', () => {
      const el = audioEl;
      if (!el) return;

      const dur = el.duration;
      // YouTube m4a streams report Infinity for duration. Use the track's
      // known duration from yt-dlp metadata as a reliable fallback.
      const safeDuration = Number.isFinite(dur) && dur > 0 ? dur : trackDuration;
      const safePosition = streamOffset + (Number.isFinite(el.currentTime) ? el.currentTime : 0);
      progress.set({ position: safePosition, duration: safeDuration });

      // Prefetch the next track's stream URL when the current remote track is
      // near ending. This ensures the upcoming track resolves before auto-advance
      // and play_stream() hits the cache instead of paying the full yt-dlp cost.
      if (safeDuration > 0 && safePosition > 0 && safePosition >= safeDuration - 10) {
        if (!prefetchedNext) {
          prefetchedNext = true;
          prefetchNextStream().catch(() => {});
        }
      } else {
        prefetchedNext = false;
      }
    });

    // Sync play → isPlaying store
    audioEl.addEventListener('play', () => {
      isPlaying.set(true);
    });

    // Sync pause → isPlaying store (but not during seek — browser pauses
    // briefly while fetching the new Range, then resumes automatically)
    audioEl.addEventListener('pause', () => {
      if (!seeking) {
        isPlaying.set(false);
      }
    });

    // Sync ended → advance to next track in queue
    audioEl.addEventListener('ended', () => {
      isPlaying.set(false);
      remoteActive.set(false);
      // Remote tracks don't have a Rust decoder thread to detect EOF,
      // so we must advance the queue from the frontend.
      nextTrack();
    });

  }
  return audioEl;
}

/**
 * Load and play a remote stream URL.
 *
 * Called when the `stream-resolved` event arrives from Rust.
 * Stops any existing remote playback first.
 *
 * For YouTube tracks, this calls `cache_remote_stream` to download the
 * stream to a local file for instant seeking. While the download is in
 * progress, playback starts from the remote proxy URL (so the user hears
 * audio immediately). Once the download completes, the audio source is
 * swapped to the local file URL for instant seek. If the download fails,
 * playback continues on the remote proxy URL.
 *
 * SoundCloud tracks use the remote proxy URL directly (their seek works).
 */
export async function loadRemoteStream(
  track: Track,
  streamUrl: string,
  remoteUrl?: string,
  proxyCapability?: string,
  streamRequestId: number = 0,
): Promise<void> {
  return loadRemoteStreamAttempt(track, streamUrl, remoteUrl, proxyCapability, streamRequestId, false);
}

async function loadRemoteStreamAttempt(
  track: Track,
  streamUrl: string,
  remoteUrl: string | undefined,
  proxyCapability: string | undefined,
  streamRequestId: number,
  alreadyReResolved: boolean = false,
  recoveryState?: RecoveryPlaybackState,
): Promise<void> {
  selectFftSource('remote');
  const linuxDirectOutput = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent);
  const audio = getAudio();
  // A new attempt supersedes a prior intentional source clear immediately.
  intentionallyStopping = false;

  // Store the track's known duration from yt-dlp metadata as fallback.
  // YouTube m4a streams report Infinity for audioEl.duration.
  trackDuration = track.duration ?? 0;
  currentSource = track.source;
  streamOffset = 0;
  const attempt: RemotePlaybackAttempt = {
    generation: ++remotePlaybackGeneration,
    startedAt: performance.now(),
    sourceUrl: '',
    startReported: false,
    runtimeReported: false,
    reResolving: alreadyReResolved,
  };
  activeRemotePlaybackAttempt = attempt;

  // Stop any current playback, including any prior MSE session.
  audio.pause();
  audio.src = '';

  // Compute the playable URL early — we need it BEFORE creating the Web Audio
  // chain on Linux so the cloned <audio> has a valid src when
  // createMediaElementSource binds it. See ensureLinuxAnalyserTap docs.
  const playableUrl = trackDuration > 0
    ? appendProxyParam(streamUrl, 'duration', String(trackDuration))
    : streamUrl;

  if (linuxDirectOutput) {
    // WebKitGTK/Linux: keep the primary element on its native direct-output
    // path (audible) and analyse a hidden clone via a MediaElementSource →
    // AnalyserNode that is NOT connected to destination (inaudible). This
    // restores remote visualizer data without silencing remote audio.
    // Pass playableUrl so the clone is correctly set up before the chain.
    ensureLinuxAnalyserTap(audio, playableUrl);
  } else {
    // createMediaElementSource can only be called once per element lifetime.
    // On non-Linux the primary element IS the analysed element and is
    // connected to destination so Web Audio owns audible output + volume.
    ensureWebAudioChain(audio, true);
  }

  // Set playback volume. When the remote track is routed through Web Audio,
  // control loudness via GainNode (audioEl.volume can become ineffective once
  // playback is flowing through createMediaElementSource on some WebKit builds).
  if (!linuxDirectOutput && gainNode) {
    gainNode.gain.value = Math.max(0, Math.min(1, get(volume) / 100));
    audio.volume = 1;
  } else {
    audio.volume = get(volume) / 100;
  }

  baseStreamUrl = playableUrl;
  currentStreamUrl = playableUrl;

  // All remote tracks use direct audio.src via the proxy. Seeking is native
  // (currentTime) for both YouTube and SoundCloud; the proxy exposes byte-range
  // metadata so the browser's media engine can seek accurately.
  audio.src = playableUrl;
  // Keep the Linux analysis clone on the same src so the analyser inspects
  // the same proxied stream the user hears. Safe no-op when no clone exists
  // (non-Linux, or before the first Linux remote load).
  if (analyserAudioEl) analyserAudioEl.src = playableUrl;
  attempt.sourceUrl = audio.src;
  installAttemptErrorHandler(audio, attempt, track, streamRequestId);

  // Start playback from the remote proxy URL immediately.
  // For YouTube, we'll swap to a local file once the cache download completes.
  try {
    await audio.play();
    // A superseded promise can fulfill after a newer attempt has failed.
    if (!isCurrentAttempt(attempt, audio)) return;
    remoteActive.set(true);
    if (recoveryState) {
      const restorePlaybackState = () => {
        audio.currentTime = recoveryState.position;
        if (recoveryState.shouldPlay) {
          void audio.play();
        } else {
          audio.pause();
        }
      };
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        restorePlaybackState();
      } else {
        if (!recoveryState.shouldPlay) audio.pause();
        audio.addEventListener('loadedmetadata', restorePlaybackState, { once: true });
      }
    }
    // A fulfilled play() promise confirms that the media element started.
    reportAttemptOutcome(attempt, false, true);
  } catch (e) {
    if (!isCurrentAttempt(attempt, audio)) return;
    reportAttemptOutcome(attempt, false, false);
    const msg = extractErrorMessage(e, get(t));
    notifications.push({ type: 'error', title: 'Playback Error', message: msg, dismissible: true });
    remoteActive.set(false);
    return; // Don't attempt cache download if playback failed
  }

  // Resume the AudioContext; the visualizers will start polling the
  // AnalyserNode when they next render (via pollRemoteFftFrame inside
  // their rAF loop). No separate FFT polling loop — the visualizer's
  // own rAF now drives FFT reads, guaranteeing fresh data every frame
  // without competing loops.
  // On Linux the analyser tap was set up above via ensureLinuxAnalyserTap;
  // on non-Linux ensureWebAudioChain already created the chain.
  resumeAudioCtx();

  // NOTE: The Rust-side proxy FFT pipeline (start_remote_fft) was disabled
  // because it downloads the entire stream before emitting FFT frames,
  // placing the visualizer data 2-3 seconds behind the actual audio playback.
  // The AnalyserNode — now properly connected to destination via a zero-gain
  // node on Linux — provides real-time FFT data synced to the audio the user
  // hears. The proxy FFT code remains in the Rust backend for potential future
  // use with progressive streaming.

  // YouTube local-cache: download the stream to a local file for instant seeking.
  // SoundCloud stays on the remote proxy (its seek works fine over HTTP Range).
  // Only cache tracks shorter than 15 minutes — longer tracks produce files
  // >15MB that take too long to download and can fail with body read errors.
  //
  // Audio normalization is now handled in the backend: when the setting is ON,
  // cache_remote_stream runs ffmpeg loudnorm (EBU R128, -14 LUFS) on the
  // downloaded file before caching. The frontend always swaps to the local
  // cache file regardless of the normalization setting — the cached file is
  // already normalized (or raw) as appropriate.
  const MAX_CACHE_DURATION_SEC = 15 * 60;
  if (track.source === Source.YouTube && remoteUrl && trackDuration > 0 && trackDuration <= MAX_CACHE_DURATION_SEC) {
    cachingStream.set(true);
    try {
      const localPath = await cacheRemoteStream(track.sourceId, remoteUrl);
      // Swap the audio source to the local file for instant seeking.
      // Only swap if the track hasn't changed while we were downloading.
      if (currentStreamUrl === playableUrl && currentSource === Source.YouTube) {
        // Route the cached file through the proxy so it is served with
        // CORS headers (Access-Control-Allow-Origin: *). The audio
        // element has crossOrigin='anonymous' set, so a non-CORS source
        // (like asset:// from convertFileSrc) would silently taint the
        // AnalyserNode and zero out frequency data. The proxy serves
        // file:// URLs with the same CORS + Range headers as remote.
        const port = parseProxyPort(playableUrl);
        const localUrl = proxyLocalUrl(port, proxyCapability, localPath);
        // Preserve current playback position across the source swap.
        // The browser must load the new source's metadata before currentTime
        // can be set — setting it immediately after src change is a no-op.
        const currentPosition = audio.currentTime;
        const wasPlaying = !audio.paused;

        swappingSource = true;

        // Revert to the proxy URL if the local file fails to load.
        // This handles: corrupt file, unsupported codec, proxy/asset error.
        const revertToProxy = () => {
          if (!swappingSource) return; // already handled
          swappingSource = false;
          audio.removeEventListener('loadedmetadata', onLoadedMetadata);
          audio.removeEventListener('error', onSwapError);
          // Restore the proxy URL and playback position.
          audio.src = playableUrl;
          if (analyserAudioEl) analyserAudioEl.src = playableUrl;
          attempt.sourceUrl = audio.src;
          currentStreamUrl = playableUrl;
          const restorePos = () => {
            audio.currentTime = currentPosition;
            if (wasPlaying) audio.play().catch(() => {});
          };
          audio.addEventListener('loadedmetadata', restorePos, { once: true });
          notifications.push({
            type: 'warning',
            title: 'Usando transmisión remota',
            message: 'No se pudo usar la caché local; la búsqueda de posición puede ser más lenta.',
            dismissible: true,
          });
        };

        const onLoadedMetadata = () => {
          audio.currentTime = currentPosition;
          swappingSource = false;
          if (wasPlaying) {
            audio.play().catch(() => {
              // Play failed after swap — revert to proxy.
              revertToProxy();
            });
          }
        };

        const onSwapError = () => {
          // Audio element error loading local file — revert to proxy.
          revertToProxy();
        };

        audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        audio.addEventListener('error', onSwapError, { once: true });
        // Fallback: if loadedmetadata doesn't fire within 3s, revert to proxy.
        setTimeout(() => {
          if (swappingSource) {
            revertToProxy();
          }
        }, 3000);
        audio.src = localUrl;
        // Keep the Linux analysis clone on the same source so the analyser
        // inspects the cached file too (with the same CORS headers).
        if (analyserAudioEl) analyserAudioEl.src = localUrl;
        currentStreamUrl = localUrl;
        attempt.sourceUrl = audio.src;
      }
    } catch (e) {
      // Cache download failed (backend validation rejected the file, network
      // error, etc.) — continue playing from the remote proxy URL.
      // This is not a playback error; seek just won't be as fast.
      swappingSource = false;
      // Cache failure is an expected degradation: preserve remote playback but
      // leave a redacted, stable diagnostic signal for the backend telemetry.
      console.warn('[cache] remote_stream_failed');
    } finally {
      cachingStream.set(false);
    }
  }
}

/** Pause remote playback. */
export function pauseRemote(): void {
  if (audioEl) {
    audioEl.pause();
  }
}

/** Resume remote playback. */
export function resumeRemote(): void {
  void resumeRemoteOrThrow().catch((e) => {
      const msg = extractErrorMessage(e, get(t));
      notifications.push({ type: 'error', title: 'Playback Error', message: msg, dismissible: true });
  });
}

/** Resume remote playback while exposing failure to application-level callers. */
export async function resumeRemoteOrThrow(): Promise<void> {
  if (!audioEl || !audioEl.src) throw new Error('No remote playback pipeline');
  resumeAudioCtx();
  await audioEl.play();
}

/** Seek to a position in seconds.
 *
 * Both YouTube and SoundCloud use native `audio.currentTime = position`. The
 * local proxy advertises `Accept-Ranges: bytes` and forwards upstream
 * `Content-Range`/`Content-Length`/206 so the browser's media engine can issue
 * accurate byte-range requests on its own. SoundCloud MP3 seeking already
 * worked; YouTube m4a seeks instantly once the local cache file is loaded
 * (see `cache_remote_stream`). */
export function seekRemote(position: number): void {
  const el = audioEl;
  if (!el) return;

  const token = ++seekToken;
  const shouldResume = !el.paused || get(isPlaying);

  wasPlayingBeforeSeek = shouldResume;
  seeking = true;

  streamOffset = 0;
  el.currentTime = position;

  const resumeAfterSeek = async () => {
    if (token !== seekToken) return;

    if (shouldResume) {
      try {
        await el.play();
      } catch {
        // Ignore transient play failures while the browser is still fetching
        // the target Range. The fallback below will retry once buffering catches up.
      }
    }

    seeking = false;
    wasPlayingBeforeSeek = false;
  };

  // After setting currentTime, the browser may fire `seeked`, `canplay`, or
  // `playing` depending on how quickly the Range request is satisfied. Listen
  // to all three and guard with seekToken so old seeks cannot stop new ones.
  const onReady = () => {
    el.removeEventListener('seeked', onReady);
    el.removeEventListener('canplay', onReady);
    el.removeEventListener('playing', onReady);
    void resumeAfterSeek();
  };

  el.addEventListener('seeked', onReady);
  el.addEventListener('canplay', onReady);
  el.addEventListener('playing', onReady);

  // Kick playback immediately. For YouTube m4a Range seeks the element can
  // remain paused until play() is requested again, even if the target is valid.
  if (shouldResume) {
    el.play().catch(() => {});
  }

  // Fallback: if no readiness event fires (Infinity duration edge cases), retry
  // once after the browser has had a moment to issue the Range request.
  setTimeout(() => {
    if (token !== seekToken) return;

    el.removeEventListener('seeked', onReady);
    el.removeEventListener('canplay', onReady);
    el.removeEventListener('playing', onReady);

    if (shouldResume) {
      el.play().catch(() => {});
    }
    seeking = false;
    wasPlayingBeforeSeek = false;
  }, 1000);
}


/** Set volume for remote playback (0-100). */
export function setRemoteVolume(value: number): void {
  if (audioEl) {
    const normalized = Math.max(0, Math.min(1, value / 100));
    const linuxDirectOutput = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent);
    if (!linuxDirectOutput && gainNode) {
      gainNode.gain.value = normalized;
      audioEl.volume = 1;
    } else {
      audioEl.volume = normalized;
    }
  }
}

/** Initialize the Web Audio API chain for normalization.
 *
 *  DEPRECATED: Web Audio API is no longer used for normalization.
 *  createMediaElementSource silences non-CORS-compliant sources (asset://
 *  URLs from convertFileSrc), which broke the cache swap for instant seeking.
 *  Normalization is now handled in the backend via ffmpeg loudnorm during
 *  cache download. These functions remain as no-ops for API compatibility.
 */
function initWebAudioChain(): void {
  // No-op: kept for API compatibility.
}

/** Enable audio normalization for remote playback.
 *
 *  No-op: normalization is applied during cache download in the backend.
 */
export function enableRemoteNormalization(): void {
  // No-op: normalization is applied during cache download in the backend.
}

/** Disable audio normalization for remote playback.
 *
 *  No-op: normalization is applied during cache download in the backend.
 */
export function disableRemoteNormalization(): void {
  // No-op: normalization is applied during cache download in the backend.
}

/** Set normalization state for remote playback.
 *  No-op now: the setting is persisted and applied on next cache download. */
export function setRemoteNormalization(_enabled: boolean): void {
  // No-op: normalization is applied during cache download in the backend.
}

/** Stop and cleanup remote playback. */
export function stopRemote(): void {
  // Clear the remote frequency source so visualizers show idle bars.
  // The FFT analyser is torn down below with the Web Audio chain, so
  // pollRemoteFftFrame will become a no-op automatically.
  clearFftSource('remote');
  // Set flag to suppress the 'error' event that fires when we clear
  // audio.src — this is intentional, not a real playback error.
  intentionallyStopping = true;
  activeRemotePlaybackAttempt = null;
  removeAttemptErrorHandler?.();
  removeAttemptErrorHandler = null;
  if (audioEl) {
    audioEl.pause();
    audioEl.src = '';
    audioEl.load();
  }
  // Decide whether to tear down the Web Audio chain. The chain is bound to a
  // specific element (tracked by mediaSourceBoundEl):
  //  - Clone (Linux): always tear down — the clone is per-load, and the chain
  //    must be reset so the next Linux load can bind a fresh clone.
  //  - Primary audioEl (non-Linux): keep the chain alive across tracks —
  //    createMediaElementSource is one-shot per element, and the primary
  //    element is reused for every remote track. Resetting would silently
  //    break the analyser on the next load.
  const boundEl = mediaSourceBoundEl;
  const isCloneChain = boundEl != null && boundEl !== audioEl;
  if (isCloneChain) {
    cloneSyncUnlisten?.();
    cloneSyncUnlisten = null;
    if (analyserAudioEl) {
      analyserAudioEl.pause();
      analyserAudioEl.src = '';
      analyserAudioEl.remove();
      analyserAudioEl = null;
    }
    mediaSource = null;
    mediaSourceBoundEl = null;
    gainNode = null;
    analyser = null;
    fftByteBins = null;
    fftFloatBins = null;
    unsubscribeAnalyserSmoothing?.();
    unsubscribeAnalyserSmoothing = null;
    if (audioCtx && typeof audioCtx.close === 'function') {
      audioCtx.close().catch(() => {});
    }
    audioCtx = null;
    analyserCloneBound = false;
  }
  normalizationActive = false;
  remoteActive.set(false);
  // Reset flag after the browser has processed the src change.
  setTimeout(() => { intentionallyStopping = false; }, 100);
}

/** Get the current HTMLAudio element (for advanced use). */
export function getAudioElement(): HTMLAudioElement | null {
  return audioEl;
}

/** Get the analyser clone's drift from the primary element, in ms.
 *  Positive means the clone is behind the primary.
 *  Returns NaN when the clone or primary is unavailable. */
export function getAnalyserDriftMs(): number {
  if (!analyserAudioEl || !audioEl) return NaN;
  return (audioEl.currentTime - analyserAudioEl.currentTime) * 1000;
}

/** Get the current AnalyserNode, if active. Used for diagnostics. */
export function getAnalyserNode(): AnalyserNode | null {
  return analyser;
}
