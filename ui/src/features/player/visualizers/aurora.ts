/**
 * Aurora visualizer renderer — soft horizontal bands of color sweeping with
 * the spectrum.
 *
 * Draws a few stacked translucent gradient bands that shift vertically with
 * low/mid/high frequency energy. Pure Canvas2D layered passes with bounded
 * interpolation state. Safe for the WebKitGTK
 * (JSC JIT disabled) dev runtime.
 *
 * Uses stacked gradients and expanded low-alpha geometry, without particles.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.30);

/** Split the spectrum into three bands (low / mid / high) by bin index. */
function bandEnergy(bins: Float32Array, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += bins[i];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Render stacked aurora bands.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, min heights).
 */
export function renderAurora(
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
  const n = bins.length;
  // Three equal bands across the spectrum.
  const lowEnd = Math.max(1, Math.floor(n / 3));
  const midEnd = Math.max(lowEnd + 1, Math.floor((2 * n) / 3));
  const low = bandEnergy(bins, 0, lowEnd);
  const mid = bandEnergy(bins, lowEnd, midEnd);
  const high = bandEnergy(bins, midEnd, n);
  const norm = (v: number) => {
    const raw = peak > 0 ? Math.min(1, v / peak) : 0;
    return Math.pow(raw, 0.85);
  };
  const lowN = norm(low);
  const midN = norm(mid);
  const highN = norm(high);

  const color = theme.palette[0] ?? theme.accentColor;
  const bandHeight = height / 3;
  const punch = 1 + (analysis?.energy ?? 0) * 0.12 + (analysis?.beat ? 0.2 : 0);

  ctx.save();

  // Low band — anchored to the bottom, rises with bass.
  const lowH = Math.max(theme.barMinHeight, lowN * bandHeight * 0.9 * punch);
  const lowTop = height - lowH;
  const lowGrad = ctx.createLinearGradient(0, lowTop, 0, height);
  lowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  lowGrad.addColorStop(1, color);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = lowGrad;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, lowTop - 4, width, lowH + 4);
  ctx.globalAlpha = 0.75;
  ctx.fillRect(0, lowTop, width, lowH);

  // Mid band — centered vertically, breathes with mids.
  const midH = Math.max(theme.barMinHeight, midN * bandHeight * 0.9 * punch);
  const midTop = height / 2 - midH / 2;
  const midGrad = ctx.createLinearGradient(0, midTop, 0, midTop + midH);
  midGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  midGrad.addColorStop(0.5, color);
  midGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = midGrad;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, midTop - 3, width, midH + 6);
  ctx.globalAlpha = 0.75;
  ctx.fillRect(0, midTop, width, midH);

  // High band — anchored to the top, descends with treble.
  const highH = Math.max(theme.barMinHeight, highN * bandHeight * 0.9 * punch);
  const highGrad = ctx.createLinearGradient(0, 0, 0, highH);
  highGrad.addColorStop(0, color);
  highGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = highGrad;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, 0, width, highH + 4);
  ctx.globalAlpha = 0.75;
  ctx.fillRect(0, 0, width, highH);

  ctx.globalAlpha = 1;
  ctx.restore();
}
