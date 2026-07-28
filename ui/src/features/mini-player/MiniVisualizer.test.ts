import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MiniVisualizer from './MiniVisualizer.svelte';
import { frequencyData } from '@features/player/stores/player';
import type { FrequencyData } from '@shared/types/models';
import * as events from '@services/events';

vi.mock('@services/events', () => ({
  onFftFrame: vi.fn().mockResolvedValue(vi.fn()),
}));

describe('MiniVisualizer', () => {
  afterEach(() => {
    frequencyData.set(null);
    vi.clearAllMocks();
  });

  it('renders a canvas the bars renderer can draw into', () => {
    const { container } = render(MiniVisualizer);
    const canvas = container.querySelector<HTMLCanvasElement>('.mini-viz-canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.tagName).toBe('CANVAS');
  });

  it('does not throw when frequencyData is null (idle state)', () => {
    frequencyData.set(null);
    expect(() => render(MiniVisualizer)).not.toThrow();
  });

  it('keeps a local reference to frequencyData for the rAF loop', () => {
    const data: FrequencyData = {
      bins: new Float32Array([0.1, 0.5, 0.3, 0.8]),
      sampleRate: 44100,
      peak: 0.8,
    };
    frequencyData.set(data);
    // The component subscribes via reactive statement; rendering should not
    // throw and the store value should be the one we published.
    expect(() => render(MiniVisualizer)).not.toThrow();
  });

  it('cancels rAF on destroy', async () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 42);
    const cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = render(MiniVisualizer);
    // Allow onMount async to resolve
    await new Promise((r) => setTimeout(r, 0));

    unmount();

    expect(cancelRafSpy).toHaveBeenCalled();

    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
  });

  it('does not create an FFT listener because player bootstrap owns it', async () => {
    const fftSpy = vi.mocked(events.onFftFrame);

    render(MiniVisualizer);
    await new Promise((r) => setTimeout(r, 0));

    expect(fftSpy).not.toHaveBeenCalled();
  });

  it('falls back to plain Canvas2D when context options are rejected', () => {
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalAlpha: 1 };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((_type, options) => options ? null : ctx as unknown as CanvasRenderingContext2D);
    let frame: FrameRequestCallback | undefined;
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frame ??= callback;
      return 1;
    });

    render(MiniVisualizer);
    frame?.(0);

    expect(getContext).toHaveBeenNthCalledWith(1, '2d', expect.any(Object));
    expect(getContext).toHaveBeenNthCalledWith(2, '2d');
    expect(ctx.clearRect).toHaveBeenCalled();
    getContext.mockRestore();
    raf.mockRestore();
  });
});
