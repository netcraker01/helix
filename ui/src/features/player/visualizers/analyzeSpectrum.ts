/**
 * Spectrum analysis — extracts bass/mid/treble energy and detects beats.
 *
 * Called once per frame by each visualizer host before dispatching to a renderer.
 */
import type { FrequencyData } from '@shared/types/models';

export interface SpectrumAnalysis {
  /** Average energy in the low-frequency band (0..1, peak-normalized). */
  bass: number;
  /** Average energy in the mid-frequency band (0..1, peak-normalized). */
  mid: number;
  /** Average energy in the high-frequency band (0..1, peak-normalized). */
  treble: number;
  /** Overall energy (weighted average of bass-heavy mix). */
  energy: number;
  /** True when bass spikes above recent average (beat detected). */
  beat: boolean;
}

/** Beat detection state — smoothed bass energy over time. */
let smoothedBass = 0;
const BEAT_SENSITIVITY = 1.35;
const SMOOTHING = 0.88;

// Reused zero analysis for the null/empty-data fast path. Returning a shared
// object is safe because callers only read it; renderers never mutate the
// analysis. This removes a per-frame allocation from the idle path.
const ZERO_ANALYSIS: SpectrumAnalysis = Object.freeze({
  bass: 0, mid: 0, treble: 0, energy: 0, beat: false,
});

// Reused analysis object for the hot path. Callers consume it synchronously
// inside one rAF tick before the next frame overwrites it, so reuse is safe.
const reuseAnalysis: SpectrumAnalysis = {
  bass: 0, mid: 0, treble: 0, energy: 0, beat: false,
};

// Hoisted clamp helpers — creating arrow functions per frame allocated two
// closures and a wrapper every call. Plain top-level functions are free.
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function shaped(v: number): number {
  return clamp01(Math.pow(v < 0 ? 0 : v, 0.75));
}

/** Reset temporal beat state for deterministic tests and fresh playback sessions. */
export function resetSpectrumAnalysis(): void {
  smoothedBass = 0;
}

/**
 * Analyze frequency data and return structured spectrum information.
 * Handles null/empty data gracefully (returns zeroed analysis).
 *
 * The returned object is reused across calls — do not retain it across
 * frames. Copy it if you need to keep it.
 */
export function analyzeSpectrum(data: FrequencyData | null): SpectrumAnalysis {
  if (!data || !data.bins.length) return ZERO_ANALYSIS;

  const { bins, peak } = data;
  const n = bins.length;
  const lowEnd = Math.max(1, Math.floor(n * 0.15));
  const midEnd = Math.max(lowEnd + 1, Math.floor(n * 0.55));

  // Band averages (raw, before normalization).
  let bassSum = 0, midSum = 0, highSum = 0;
  for (let i = 0; i < lowEnd; i++) bassSum += bins[i];
  for (let i = lowEnd; i < midEnd; i++) midSum += bins[i];
  for (let i = midEnd; i < n; i++) highSum += bins[i];

  const bassRaw = lowEnd > 0 ? bassSum / lowEnd : 0;
  const midRaw = (midEnd - lowEnd) > 0 ? midSum / (midEnd - lowEnd) : 0;
  const highRaw = (n - midEnd) > 0 ? highSum / (n - midEnd) : 0;

  // Normalize to peak (0..1) with moderate power curve. Clamp the raw input
  // to 0..1 so a peak that underestimates the true bin magnitudes (weak remote
  // analyser data) cannot drive the bands above 1 before shaping.
  // Fully inlined — no per-frame closure allocation. peak>0 is the common
  // case; the else branch yields 0 which `shaped` maps to 0.
  const invPeak = peak > 0 ? 1 / peak : 0;
  const bass = peak > 0 ? shaped(clamp01(bassRaw * invPeak)) : 0;
  const mid = peak > 0 ? shaped(clamp01(midRaw * invPeak)) : 0;
  const treble = peak > 0 ? shaped(clamp01(highRaw * invPeak)) : 0;
  const energy = clamp01(bass * 0.5 + mid * 0.3 + treble * 0.2);

  // Beat detection: bass spikes above smoothed average.
  smoothedBass = smoothedBass * SMOOTHING + bassRaw * (1 - SMOOTHING);
  const beat = bassRaw > smoothedBass * BEAT_SENSITIVITY && bass > 0.15;

  reuseAnalysis.bass = bass;
  reuseAnalysis.mid = mid;
  reuseAnalysis.treble = treble;
  reuseAnalysis.energy = energy;
  reuseAnalysis.beat = beat;
  return reuseAnalysis;
}
