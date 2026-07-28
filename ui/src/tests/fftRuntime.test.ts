import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let fftEventCallback: ((payload: unknown) => void) | undefined;
const subscribeEvent = vi.fn(async (event: string, callback: (payload: unknown) => void) => {
  if (event === 'fft-frame') fftEventCallback = callback;
  return vi.fn();
});

vi.mock('@services/tauri', () => ({
  subscribeEvent,
  invokeCommand: vi.fn(),
}));

describe('local FFT runtime boundary', () => {
  afterEach(async () => {
    const { frequencyData, selectFftSource, visualizerReactivity } = await import('@features/player/stores/player');
    frequencyData.set(null);
    selectFftSource('local');
    visualizerReactivity.set(1);
  });

  it('moves a realistic Rust event payload through the listener and source gate', async () => {
    const { frequencyData, initLocalFft, selectFftSource } = await import('@features/player/stores/player');
    selectFftSource('remote');
    selectFftSource('local');
    await initLocalFft();

    fftEventCallback?.({
      bins: Array.from({ length: 512 }, (_, index) => (index % 32) / 64),
      sampleRate: 48_000,
      peak: 31 / 64,
    });

    const frame = get(frequencyData);
    expect(subscribeEvent).toHaveBeenCalledTimes(1);
    expect(frame?.bins).toBeInstanceOf(Float32Array);
    expect(frame?.bins).toHaveLength(512);
    expect(frame?.bins[31]).toBeCloseTo(31 / 64);
    expect(frame?.sampleRate).toBe(48_000);
  });

  it('rejects malformed and legacy payloads instead of publishing a blank frame', async () => {
    const { frequencyData, initLocalFft } = await import('@features/player/stores/player');
    await initLocalFft();

    expect(() => fftEventCallback?.({ bins: [0.2], sample_rate: 44_100, peak: 0.2 }))
      .toThrow(/legacy sample_rate/);
    expect(() => fftEventCallback?.({ bins: [Number.NaN], sampleRate: 44_100, peak: 0.2 }))
      .toThrow(/finite non-negative/);
    expect(get(frequencyData)).toBeNull();
  });

  it('keeps listener registration idempotent', async () => {
    const { initLocalFft } = await import('@features/player/stores/player');
    await Promise.all([initLocalFft(), initLocalFft(), initLocalFft()]);
    expect(subscribeEvent).toHaveBeenCalledTimes(1);
  });

  it('publishes bins unchanged across reactivity values (reactivity is interpolation speed, not gain)', async () => {
    const {
      frequencyData,
      publishFftFrame,
      selectFftSource,
      visualizerReactivity,
    } = await import('@features/player/stores/player');
    const input = { bins: new Float32Array([0.08, 0.2, 0.35]), sampleRate: 44_100, peak: 0.35 };
    // Force a source switch so the publish throttle resets between tests.
    selectFftSource('remote');
    selectFftSource('local');
    const nowSpy = vi.spyOn(performance, 'now');

    visualizerReactivity.set(0.5);
    nowSpy.mockReturnValueOnce(1);
    publishFftFrame('local', input);
    const low = Array.from(get(frequencyData)!.bins);
    visualizerReactivity.set(2);
    nowSpy.mockReturnValueOnce(20);
    publishFftFrame('local', input);
    const high = Array.from(get(frequencyData)!.bins);

    expect(low.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(high.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    // Reactivity controls interpolation speed in renderers, not bin gain at
    // publish time — bins must be identical across reactivity settings.
    expect(high).toEqual(low);
  });
});
