/**
 * Radial visualizer renderer — spectrum bars arranged around a circle.
 *
 * Bins are grouped into a fixed number of radial segments and drawn as bars
 * extending outward from the center. Pure Canvas2D, single pass, no
 * bounded interpolation state. Safe for the WebKitGTK
 * (JSC JIT disabled) dev runtime.
 *
 * Uses only transforms and rectangle passes, avoiding unstable canvas effects.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.34);

/**
 * Render a radial spectrum.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, gaps, min heights).
 */
export function renderRadial(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: FrequencyData | null,
  theme: VisualizerTheme,
  analysis?: SpectrumAnalysis
): void {
  if (!data || !data.bins.length) return;

  const frame = interpolateFrame(data, theme.reactivity)!;
  const { bins, peak } = frame;
  const cx = width / 2;
  const cy = height / 2;
  // Inner radius is a fraction of the smaller dimension, leaving room for bars.
  const base = Math.min(width, height);
  const beatScale = analysis?.beat ? 1.1 : 1;
  const innerRadius = Math.max(8, base * 0.18 * beatScale);
  const maxBarLength = Math.max(4, base * 0.32);

  // Cap the segment count so very large FFT sizes don't draw hairline bars.
  const segments = Math.min(bins.length, 96);
  const groupSize = Math.ceil(bins.length / segments);
  const barGap = theme.barGap;
  const barMinHeight = theme.barMinHeight;
  // Angular width of each bar, leaving a small gap between bars.
  const angleStep = (Math.PI * 2) / segments;
  const barAngle = Math.max(0.02, angleStep - (barGap / innerRadius));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = theme.palette[0] ?? theme.accentColor;

  // Pre-compute bar geometry for each segment to avoid re-computing across
  // the shadow and main passes.
  const barLengths = new Float32Array(segments);
  const barThicknesses = new Float32Array(segments);
  for (let i = 0; i < segments; i++) {
    barLengths[i] = barLengthAt(i, bins, peak, analysis, barMinHeight, maxBarLength, groupSize);
    barThicknesses[i] = Math.max(1, innerRadius * barAngle);
  }

  const angleOrigin = -Math.PI / 2; // bars start at top

  // Shadow pass (alpha 0.16) — replaces ctx.save/rotate/restore per segment
  // with a single ctx.setTransform call (3 ops → 1 op per segment).
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < segments; i++) {
    const angle = angleOrigin + i * angleStep;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.setTransform(cos, sin, -sin, cos, cx, cy);
    const bl = barLengths[i];
    const bt = barThicknesses[i];
    ctx.fillRect(innerRadius - 2, -bt / 2 - 1, bl + 4, bt + 2);
  }

  // Main pass (alpha 0.75).
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < segments; i++) {
    const angle = angleOrigin + i * angleStep;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.setTransform(cos, sin, -sin, cos, cx, cy);
    const bl = barLengths[i];
    const bt = barThicknesses[i];
    ctx.fillRect(innerRadius, -bt / 2, bl, bt);
  }

  // Reset transform so subsequent canvas operations are in identity space.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function barLengthAt(
  i: number,
  bins: Float32Array,
  peak: number,
  analysis: SpectrumAnalysis | undefined,
  barMinHeight: number,
  maxBarLength: number,
  groupSize: number,
): number {
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
  const punch = 1 + (analysis?.bass ?? 0) * 0.1 + (analysis?.beat ? 0.16 : 0);
  return Math.max(barMinHeight, shaped * maxBarLength * punch);
}
