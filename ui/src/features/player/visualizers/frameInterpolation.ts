import type { FrequencyData } from '@shared/types/models';

/** Create an allocation-stable interpolator for one visualizer host. */
export function createFrameInterpolator(baseLerp: number) {
  let previousBins = new Float32Array(0);
  const frame: FrequencyData = { bins: previousBins, sampleRate: 0, peak: 0 };

  return (data: FrequencyData | null, reactivity = 1): FrequencyData | null => {
    if (!data?.bins.length) return data;

    const lerp = Math.min(1, Math.max(0.01, baseLerp * reactivity));
    if (previousBins.length !== data.bins.length) {
      previousBins = new Float32Array(data.bins);
      frame.bins = previousBins;
    } else {
      for (let index = 0; index < data.bins.length; index++) {
        previousBins[index] += (data.bins[index] - previousBins[index]) * lerp;
      }
    }
    frame.sampleRate = data.sampleRate;
    frame.peak = data.peak;
    return frame;
  };
}
