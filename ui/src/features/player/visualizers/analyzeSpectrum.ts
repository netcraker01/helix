import type { FrequencyData } from '@shared/types/models';

export interface SpectrumAnalysis {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  beat: boolean;
}

const ZERO_ANALYSIS: SpectrumAnalysis = Object.freeze({
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  beat: false,
});

const BEAT_SENSITIVITY = 1.35;
const BASS_SMOOTHING = 0.88;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeBand(value: number, peak: number): number {
  return peak > 0 ? clamp01(Math.pow(clamp01(value / peak), 0.75)) : 0;
}

/** Create independent temporal analysis state for one visualizer host. */
export function createSpectrumAnalyzer(): (data: FrequencyData | null) => SpectrumAnalysis {
  let smoothedBass = 0;
  const result: SpectrumAnalysis = { ...ZERO_ANALYSIS };

  return (data) => {
    if (!data?.bins.length) return ZERO_ANALYSIS;

    const { bins, peak } = data;
    const lowEnd = Math.max(1, Math.floor(bins.length * 0.15));
    const midEnd = Math.min(bins.length, Math.max(lowEnd + 1, Math.floor(bins.length * 0.55)));
    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;

    for (let index = 0; index < lowEnd; index++) bassSum += bins[index];
    for (let index = lowEnd; index < midEnd; index++) midSum += bins[index];
    for (let index = midEnd; index < bins.length; index++) trebleSum += bins[index];

    const bassRaw = bassSum / lowEnd;
    const midRaw = midEnd > lowEnd ? midSum / (midEnd - lowEnd) : 0;
    const trebleRaw = bins.length > midEnd ? trebleSum / (bins.length - midEnd) : 0;
    result.bass = normalizeBand(bassRaw, peak);
    result.mid = normalizeBand(midRaw, peak);
    result.treble = normalizeBand(trebleRaw, peak);
    result.energy = clamp01(result.bass * 0.5 + result.mid * 0.3 + result.treble * 0.2);
    smoothedBass = smoothedBass * BASS_SMOOTHING + bassRaw * (1 - BASS_SMOOTHING);
    result.beat = bassRaw > smoothedBass * BEAT_SENSITIVITY && result.bass > 0.15;
    return result;
  };
}

const defaultAnalyzer = createSpectrumAnalyzer();

/** Convenience analyzer for callers that only need one shared analysis stream. */
export function analyzeSpectrum(data: FrequencyData | null): SpectrumAnalysis {
  return defaultAnalyzer(data);
}
