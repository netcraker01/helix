import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import NowPlayingVisualizer from '@features/player/components/NowPlayingVisualizer.svelte';
import Visualizer from '@features/player/components/Visualizer.svelte';
import MiniVisualizer from '@features/mini-player/MiniVisualizer.svelte';
import {
  currentTrack,
  frequencyData,
  modoCineActive,
  visualizerMode,
  vizColor,
  vizColorMode,
} from '@features/player/stores/player';
import { VISUALIZER_MODES } from '@features/player/visualizers/registry';

type FrameCallback = (time: number) => void;

const frame = {
  bins: new Float32Array(Array.from({ length: 128 }, (_, index) => 0.05 + (index % 24) / 30)),
  sampleRate: 44_100,
  peak: 0.82,
};

function canvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('visualizer canvas runtime', () => {
  let callbacks: FrameCallback[];
  let timeoutCallbacks: Array<() => void>;
  let contexts: CanvasRenderingContext2D[];

  beforeEach(() => {
    callbacks = [];
    timeoutCallbacks = [];
    contexts = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('setTimeout', vi.fn((callback: TimerHandler) => {
      if (typeof callback === 'function') timeoutCallbacks.push(callback as () => void);
      return timeoutCallbacks.length as unknown as ReturnType<typeof setTimeout>;
    }));
    vi.stubGlobal('clearTimeout', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (_type, options) {
      if (options) throw new TypeError('WebKit rejected context hints');
      const context = canvasContext();
      contexts.push(context);
      return context;
    });
    currentTrack.set({ id: 'local:runtime', title: 'Runtime', localPath: '/music/runtime.flac' } as never);
    frequencyData.set(frame);
    modoCineActive.set(true);
    vizColor.set('#22c55e');
    vizColorMode.set('fixed');
  });

  afterEach(() => {
    cleanup();
    frequencyData.set(null);
    modoCineActive.set(false);
    visualizerMode.set('bars');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function runNextFrame(): void {
    const callback = callbacks.shift();
    if (typeof callback === 'function') {
      callback(performance.now());
      return;
    }
    const timeoutCallback = timeoutCallbacks.shift();
    expect(timeoutCallback).toBeTypeOf('function');
    timeoutCallback?.();
  }

  async function renderUntilCanvasDraws(attempts = 4): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      await tick();
      runNextFrame();
      if (contexts[0]) return;
    }
  }

  it('sizes Now Playing canvas and draws realistic FFT bins with WebKit fallback', async () => {
    const { container } = render(NowPlayingVisualizer);
    await renderUntilCanvasDraws();

    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(240);
    expect(contexts[0]).toBeDefined();
    expect(contexts[0].clearRect).toHaveBeenCalled();
    expect(contexts[0].fillRect).toHaveBeenCalled();
  });

  it('sizes mini-player canvas and draws realistic FFT bins with WebKit fallback', async () => {
    const { container } = render(MiniVisualizer);
    await renderUntilCanvasDraws();

    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(240);
    expect(contexts[0]).toBeDefined();
    expect(contexts[0].clearRect).toHaveBeenCalled();
    expect(contexts[0].fillRect).toHaveBeenCalled();
  });

  it.each(VISUALIZER_MODES)('draws realistic FFT bins in fullscreen $id mode', async ({ id }) => {
    visualizerMode.set(id);
    const { container } = render(Visualizer);
    await renderUntilCanvasDraws();

    const canvas = container.querySelector('canvas')!;
    const context = contexts[0] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(context.clearRect).toHaveBeenCalled();
    expect(
      context.fillRect.mock.calls.length
      + context.stroke.mock.calls.length
      + context.fill.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('produces valid fixed and aurora CSS colors during real draws', async () => {
    visualizerMode.set('bars');
    const mounted = render(Visualizer);
    await tick();
    runNextFrame();
    expect(contexts[0].fillStyle).toBe('#22c55e');
    mounted.unmount();

    callbacks = [];
    contexts = [];
    vizColorMode.set('aurora');
    render(Visualizer);
    await tick();
    runNextFrame();
    expect(String(contexts[0].fillStyle)).toMatch(/^hsl\([\d.]+, 80%, 60%\)$/);
  });
});
