/**
 * Shared visualizer settings utilities.
 *
 * Keeps the mapping from the user-facing `visualizerReactivity` store to the
 * AnalyserNode smoothing time constant in the non-Linux remote Web Audio path.
 * Linux remote playback and local Rust playback deliberately do not use it.
 */

/**
 * Convert the UI reactivity slider (0.5..2.0) to an AnalyserNode
 * smoothingTimeConstant value (0.92..0.45). The mapping is inverted:
 * higher reactivity means less smoothing (snappier bars), lower
 * reactivity means more smoothing (softer bars).
 */
export function reactivityToSmoothing(reactivity: number): number {
  if (!Number.isFinite(reactivity)) return 0.725;
  const clamped = Math.min(2, Math.max(0.5, reactivity));
  // Normalize to 0..1 within the range.
  const t = (clamped - 0.5) / 1.5;
  // Linear interpolation from high smoothing at low reactivity (0.92)
  // to low smoothing at high reactivity (0.45).
  return 0.92 - t * (0.92 - 0.45);
}
