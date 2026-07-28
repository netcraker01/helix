/**
 * Mirror visualizer renderer — bars mirrored from the horizontal center.
 *
 * Visually distinct from `bars` (which grow from the bottom): bars here grow
 * up and down symmetrically from the vertical midline, giving an
 * Winamp-style "reflection" look. Pure Canvas2D, single pass, no
 * allocations per frame. Safe for the WebKitGTK (JSC JIT disabled) dev runtime.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.33);

/**
 * Render bars mirrored from the horizontal center.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, gaps, min heights).
 */
export function renderMirror(
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
  const rawMaxBars = Math.min(bins.length, Math.max(1, Math.floor(width / 4)));
  const groupSize = Math.ceil(bins.length / rawMaxBars);

  // Count active bars (at least one bin > 0 in the group) so we can
  // redistribute width only across bars with signal.
  let activeBarCount = 0;
  for (let i = 0; i < rawMaxBars; i++) {
    const start = i * groupSize;
    const end = Math.min((i + 1) * groupSize, bins.length);
    for (let j = start; j < end; j++) {
      if (bins[j] > 0) { activeBarCount++; break; }
    }
  }
  if (activeBarCount === 0) activeBarCount = rawMaxBars;

  const barGap = theme.barGap;
  const barMinHeight = theme.barMinHeight;
  const barWidth = Math.max(1, (width - barGap * (activeBarCount - 1)) / activeBarCount);
  const midY = height / 2;
  const color = theme.palette[0] ?? theme.accentColor;

  ctx.fillStyle = color;

  // Two-pass rendering: shadow glow first, then crisp main bars. Batching by
  // alpha reduces canvas state changes from 2×barCount to just 3 (shadow,
  // main, reset).
  //
  // Shadow pass (alpha 0.16) — slightly larger bars for a soft glow.
  ctx.globalAlpha = 0.16;
  let drawIdx = 0;
  for (let i = 0; i < rawMaxBars; i++) {
    const h = halfBarAt(i, bins, peak, analysis, height, barMinHeight, midY, groupSize);
    if (h <= 0) continue;
    const x = drawIdx * (barWidth + barGap);
    ctx.fillRect(x - 1, midY - h - 2, barWidth + 2, h + 2);
    ctx.fillRect(x - 1, midY, barWidth + 2, h + 2);
    drawIdx++;
  }
  // Main pass (alpha 0.75) — crisp bars from the center.
  ctx.globalAlpha = 0.75;
  drawIdx = 0;
  for (let i = 0; i < rawMaxBars; i++) {
    const h = halfBarAt(i, bins, peak, analysis, height, barMinHeight, midY, groupSize);
    if (h <= 0) continue;
    const x = drawIdx * (barWidth + barGap);
    ctx.fillRect(x, midY - h, barWidth, h);
    ctx.fillRect(x, midY, barWidth, h);
    drawIdx++;
  }
  ctx.globalAlpha = 1;
}

function halfBarAt(
  i: number,
  bins: Float32Array,
  peak: number,
  analysis: SpectrumAnalysis | undefined,
  height: number,
  barMinHeight: number,
  midY: number,
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
  const normalizedHeight = peak > 0 ? Math.min(1, magnitude / peak) : 0;
  const shaped = Math.pow(normalizedHeight, 0.85);
  const punch = 1 + (analysis?.bass ?? 0) * 0.1 + (analysis?.beat ? 0.18 : 0);
  const h = shaped * height * 0.45 * punch;
  return Math.min(midY, h >= barMinHeight / 2 ? h : 0);
}
