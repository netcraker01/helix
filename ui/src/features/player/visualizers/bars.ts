/**
 * Bars visualizer renderer — classic spectrum bars.
 *
 * Pure Canvas2D function. Called once per animation frame from
 * `Visualizer.svelte`'s single requestAnimationFrame loop. Has no Svelte
 * reactivity, no DOM listeners, and no GPU/shader work — safe for the
 * WebKitGTK (JSC JIT disabled) dev runtime.
 *
 * Grouping: when the FFT bin count exceeds the available bar slots, bins are
 * averaged per group so the visual stays consistent across track/sample-rate
 * changes without reallocating buffers.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

/** Frame interpolation factor. Lower = smoother/slower bars, higher = snappier.
 *  The effective lerp per frame is `baseLerp * reactivity`, so the user's
 *  reactivity slider (0.5..2.0, default 1.0) controls the range:
 *    min reactivity 0.5 → lerp = 0.5 * 0.5 = 0.25 (smooth)
 *    default reactivity → lerp = 0.5 * 1.0 = 0.50 (moderate snap)
 *    max reactivity 2.0 → lerp = 0.5 * 2.0 = 1.00 (full snap, no interpolation)
 *
 *  On Linux the AnalyserNode's smoothingTimeConstant is forced to zero because
 *  the clone is inaudible, so ALL smoothing comes from this interpolator.
 *  The Rust proxy FFT pipeline also bypasses the AnalyserNode — same path. */
const interpolateFrame = createFrameInterpolator(0.5);

// ── Grouping cache ──────────────────────────────────────────────────
// `renderBars` is called every frame. When the bin count and canvas width
// are stable (the common case for a given track + window size), the group
// boundaries, bar width, and group size don't change. We cache them keyed by
// (bins.length, width) so the per-frame work is just the inner sum loop, not
// a fresh Math.ceil/Math.floor/max chain plus a closure-free inner loop.
let cachedBinsLen = -1;
let cachedWidth = -1;
let cachedMaxBars = 0;
let cachedGroupSize = 0;
let cachedBarWidth = 0;

/**
 * Render a left-to-right bar spectrum.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, gaps, min heights).
 */
export function renderBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: FrequencyData | null,
  theme: VisualizerTheme,
  analysis?: SpectrumAnalysis
): void {
  const barGap = theme.barGap;
  const barMinHeight = theme.barMinHeight;
  const color = theme.palette[0] ?? theme.accentColor;
  ctx.fillStyle = color;

  // Idle / no-data fallback: draw a small static bar pattern so the canvas
  // never looks completely empty.
  if (!data || !data.bins.length) {
    const maxBars = Math.max(1, Math.floor(width / 3));
    const barWidth = Math.max(1, (width - barGap * (maxBars - 1)) / maxBars);
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < maxBars; i++) {
      const h = Math.max(barMinHeight, Math.min(2, height * 0.12));
      const x = i * (barWidth + barGap);
      ctx.fillRect(x, height - h, barWidth, h);
    }
    ctx.globalAlpha = 1;
    return;
  }

  const frame = interpolateFrame(data, theme.reactivity)!;
  const { bins, peak } = frame;

  // Count how many bars would have real signal (magnitude > 0) so we can
  // redistribute the canvas width only across active bars, leaving no gaps
  // where bins are silent.
  const rawMaxBars = Math.min(bins.length, Math.max(1, Math.floor(width / 6)));
  const rawGroupSize = Math.ceil(bins.length / rawMaxBars);
  let activeBarCount = 0;
  for (let i = 0; i < rawMaxBars; i++) {
    const start = i * rawGroupSize;
    const end = Math.min((i + 1) * rawGroupSize, bins.length);
    for (let j = start; j < end; j++) {
      if (bins[j] > 0) { activeBarCount++; break; }
    }
  }
  if (activeBarCount === 0) activeBarCount = rawMaxBars;

  // Cache the grouping geometry only when the active bar count or width changes.
  if (activeBarCount !== cachedBinsLen || width !== cachedWidth) {
    cachedBinsLen = activeBarCount;
    cachedWidth = width;
    cachedMaxBars = activeBarCount;
    cachedGroupSize = rawGroupSize;
    cachedBarWidth = Math.max(1, (width - barGap * (cachedMaxBars - 1)) / cachedMaxBars);
  }
  const maxBars = cachedMaxBars;
  const groupSize = cachedGroupSize;
  const barWidth = cachedBarWidth;

  // Single-pass rendering: no shadow/glow pass. On WebKitGTK (software
  // Canvas2D), each fillRect is a CPU-bound memory fill — halving the draw
  // calls from 2×barCount to 1×barCount directly improves frame time.
  ctx.globalAlpha = 0.85;
  let drawIdx = 0;
  for (let i = 0; i < rawMaxBars; i++) {
    const h = barHeightAt(i, bins, peak, analysis, height, barMinHeight);
    if (h <= 0) continue;
    const x = drawIdx * (cachedBarWidth + barGap);
    ctx.fillRect(x, yAt(height, h), cachedBarWidth, h);
    drawIdx++;
  }
  ctx.globalAlpha = 1;
}

function barHeightAt(
  i: number,
  bins: Float32Array,
  peak: number,
  analysis: SpectrumAnalysis | undefined,
  height: number,
  barMinHeight: number,
): number {
  const groupSize = cachedGroupSize;
  const groupStart = i * groupSize;
  const groupEnd = Math.min((i + 1) * groupSize, bins.length);
  let sum = 0;
  let count = 0;
  for (let j = groupStart; j < groupEnd; j++) {
    sum += bins[j];
    count++;
  }
  const magnitude = count > 0 ? sum / count : 0;
  const normalized = peak > 0 ? Math.min(1, magnitude / peak) : 0;
  const shaped = Math.pow(normalized, 0.85);
  const punch = 1 + (analysis?.bass ?? 0) * 0.12 + (analysis?.beat ? 0.2 : 0);
  const h = shaped * height * 0.9 * punch;
  return Math.min(height, h >= barMinHeight ? h : 0);
}

function yAt(height: number, barHeight: number): number {
  return height - barHeight;
}
