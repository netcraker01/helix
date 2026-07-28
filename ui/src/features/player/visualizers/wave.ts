/**
 * Wave visualizer renderer — oscilloscope-style line across the canvas.
 *
 * Treats the FFT bins as a time-domain-ish waveform and strokes a smooth
 * horizontal line that deflects vertically with magnitude. Pure Canvas2D,
 * layered passes with bounded interpolation state. Safe for
 * the WebKitGTK (JSC JIT disabled) dev runtime.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.32);

/**
 * Render a horizontal oscilloscope line.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, stroke width).
 */
export function renderWave(
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
  const midY = height / 2;
  const n = bins.length;
  const stepX = width / Math.max(1, n - 1);

  const color = theme.palette[0] ?? theme.accentColor;

  const punch = 1 + (analysis?.mid ?? 0) * 0.12 + (analysis?.beat ? 0.18 : 0);

  // Soft expanded underlay.
  ctx.save();
  ctx.lineWidth = Math.max(3, theme.barMinHeight * 3);
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.16;

  ctx.beginPath();
  ctx.moveTo(0, midY);
  for (let i = 0; i < n; i++) {
    const magnitude = bins[i];
    const normalized = peak > 0 ? Math.min(1, magnitude / peak) : 0;
    const shaped = Math.pow(normalized, 0.85);
    // Map shaped 0..1 to ±0.45 * height around the midline.
    const y = midY - (shaped - 0.5) * 2 * (height * 0.45) * punch;
    ctx.lineTo(i * stepX, y);
  }
  ctx.lineTo(width, midY);
  ctx.stroke();

  // Crisp main line on top
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1, theme.barMinHeight);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  for (let i = 0; i < n; i++) {
    const magnitude = bins[i];
    const normalized = peak > 0 ? Math.min(1, magnitude / peak) : 0;
    const shaped = Math.pow(normalized, 0.85);
    const y = midY - (shaped - 0.5) * 2 * (height * 0.45) * punch;
    ctx.lineTo(i * stepX, y);
  }
  ctx.lineTo(width, midY);
  ctx.stroke();
  ctx.restore();
}
