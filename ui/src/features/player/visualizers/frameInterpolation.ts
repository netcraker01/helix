import type { FrequencyData } from '@shared/types/models';

/**
 * Create renderer-local frame interpolation.
 * @param baseLerp - base interpolation factor (0..1). Lower = smoother/slower.
 * The actual lerp per frame is `baseLerp * reactivity`, so higher reactivity
 * means less smoothing (bars snap faster), lower reactivity means more
 * smoothing (bars move gentler).
 *
 * Performance: the returned FrequencyData object is reused across calls —
 * callers consume it synchronously inside one rAF tick, so reuse is safe.
 * This removes a per-frame object spread from the hot path.
 */
export function createFrameInterpolator(baseLerp: number): (data: FrequencyData | null, reactivity?: number) => FrequencyData | null {
  let previousBins = new Float32Array(0);
  // Reused result frame — avoids a per-frame `{ ...data, bins }` allocation.
  const reuseFrame: FrequencyData = { bins: previousBins, sampleRate: 0, peak: 0 };

  return (data, reactivity = 1) => {
    if (!data || data.bins.length === 0) return data;
    const lerp = Math.min(1, Math.max(0.01, baseLerp * reactivity));
    if (previousBins.length !== data.bins.length) {
      previousBins = new Float32Array(data.bins);
      reuseFrame.bins = previousBins;
    } else {
      for (let i = 0; i < data.bins.length; i++) {
        previousBins[i] += (data.bins[i] - previousBins[i]) * lerp;
      }
    }
    reuseFrame.sampleRate = data.sampleRate;
    reuseFrame.peak = data.peak;
    return reuseFrame;
  };
}
