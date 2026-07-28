import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

let fftEventCallback: ((payload: unknown) => void) | undefined;

vi.mock('@services/tauri', () => ({
  subscribeEvent: vi.fn(async (event: string, callback: (payload: unknown) => void) => {
    if (event === 'fft-frame') fftEventCallback = callback;
    return vi.fn();
  }),
  invokeCommand: vi.fn(),
}));

describe('Tauri FFT event to canvas runtime', () => {
  const fillRect = vi.fn();
  const clearRect = vi.fn();
  let animationFrame: FrameRequestCallback | undefined;
  let timeoutCallback: (() => void) | undefined;

  beforeEach(() => {
    fillRect.mockClear();
    clearRect.mockClear();
    animationFrame = undefined;
    timeoutCallback = undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setTimeout', vi.fn((callback: TimerHandler) => {
      if (typeof callback === 'function') timeoutCallback = callback as () => void;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }));
    vi.stubGlobal('clearTimeout', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect,
      fillRect,
      fillStyle: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(async () => {
    cleanup();
    const { frequencyData, selectFftSource } = await import('@features/player/stores/player');
    frequencyData.set(null);
    selectFftSource('local');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('validates a non-zero Rust payload, publishes it, and performs canvas draws', async () => {
    const [{ default: NowPlayingVisualizer }, player] = await Promise.all([
      import('@features/player/components/NowPlayingVisualizer.svelte'),
      import('@features/player/stores/player'),
    ]);
    player.selectFftSource('local');
    await player.initLocalFft();
    render(NowPlayingVisualizer);

    fftEventCallback?.({
      bins: Array.from({ length: 512 }, (_, index) => 0.02 + (index % 32) / 64),
      sampleRate: 48_000,
      peak: 0.51,
    });
    await tick();
    timeoutCallback?.();

    expect(clearRect).toHaveBeenCalledWith(0, 0, 640, 160);
    expect(fillRect).toHaveBeenCalled();
    expect(fillRect.mock.calls.some(([, , width, height]) => width > 0 && height > 0)).toBe(true);
  });
});
