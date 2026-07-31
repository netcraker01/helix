import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import Visualizer from '@features/player/components/Visualizer.svelte';
import NowPlayingVisualizer from '@features/player/components/NowPlayingVisualizer.svelte';
import MiniVisualizer from '@features/mini-player/MiniVisualizer.svelte';
import { currentTrack, frequencyData, modoCineActive } from '@features/player/stores/player';
import { setVisualizerReactivity, setVizColor, vizColorMode } from '@features/player/stores/visualizerSettings';

describe('visualizer canvas hosts', () => {
  const contexts: Array<CanvasRenderingContext2D> = [];
  const frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    contexts.length = 0;
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const context = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D;
      contexts.push(context);
      return context;
    });
    currentTrack.set({ id: 'runtime-track', title: 'Runtime' } as never);
    frequencyData.set({
      bins: new Float32Array([0.1, 0.4, 0.8, 0.3]),
      sampleRate: 44_100,
      peak: 0.8,
    });
    setVizColor('#22c55e');
    vizColorMode.set('fixed');
    setVisualizerReactivity(1.5);
  });

  afterEach(() => {
    cleanup();
    currentTrack.set(null);
    frequencyData.set(null);
    modoCineActive.set(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function expectDraw(component: typeof Visualizer): Promise<void> {
    const { container } = render(component);
    await tick();
    frames.shift()?.(100);

    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(160);
    expect(contexts[0].clearRect).toHaveBeenCalled();
    expect(contexts[0].fillRect).toHaveBeenCalled();
    expect(contexts[0].fillStyle).toBe('#22c55e');
  }

  it('draws the Now Playing host from shared FFT data', async () => {
    await expectDraw(NowPlayingVisualizer as typeof Visualizer);
  });

  it('clears the Now Playing host after FFT data is removed', async () => {
    render(NowPlayingVisualizer);
    await tick();
    frames.shift()?.(100);
    const drawsWithData = vi.mocked(contexts[0].fillRect).mock.calls.length;

    frequencyData.set(null);
    await tick();
    frames.shift()?.(116);

    expect(contexts[0].clearRect).toHaveBeenCalledTimes(2);
    expect(vi.mocked(contexts[0].fillRect).mock.calls.length).toBeGreaterThan(drawsWithData);
  });

  it('draws the mini-player host with its fixed compact palette', async () => {
    const { container } = render(MiniVisualizer);
    await tick();
    frames.shift()?.(100);

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(contexts[0].fillRect).toHaveBeenCalled();
    expect(contexts[0].fillStyle).toBe('#000000');
  });

  it('draws the fullscreen host and cancels scheduling on unmount', async () => {
    modoCineActive.set(true);
    const mounted = render(Visualizer);
    await tick();
    frames.shift()?.(100);

    expect(contexts[0].fillRect).toHaveBeenCalled();
    mounted.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
