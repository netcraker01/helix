/**
 * Tunnel visualizer renderer — concentric rings expanding from the center.
 *
 * Draws a set of rings that grow outward from the canvas center, driven by
 * overall spectrum energy and a read-only time term (`performance.now()`).
 * No spawn queue or particle list: each ring's radius is a function of
 * `(energy, time, ringIndex)`, so the "tunnel" illusion stays bounded. Safe for
 * the WebKitGTK (JSC JIT disabled) dev runtime.
 *
 * Uses ordinary stroke/fill passes and renderer-local interpolation only.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.32);

/** Number of concurrent rings in the tunnel. Bounded for cheap frames. */
const RING_COUNT = 8;
/** Expansion cycle duration in ms. Controls how fast rings travel outward. */
const RING_CYCLE_MS = 1400;
/** Base ring thickness in pixels (scaled by energy). */
const BASE_STROKE = 2;

/**
 * Render concentric expanding rings (tunnel effect).
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, gaps, min heights).
 */
export function renderTunnel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: FrequencyData | null,
  theme: VisualizerTheme,
  analysis?: SpectrumAnalysis
): void {
  // Overall energy: average of the low and mid bands for a "musical" drive.
  let energy = 0;
  const frame = interpolateFrame(data, theme.reactivity);
  if (frame && frame.bins.length) {
    const { bins, peak } = frame;
    const n = bins.length;
    const lowEnd = Math.max(1, Math.floor(n / 3));
    const midEnd = Math.max(lowEnd + 1, Math.floor((2 * n) / 3));
    let sum = 0;
    for (let i = 0; i < midEnd; i++) sum += bins[i];
    const avg = sum / midEnd;
    const normalized = peak > 0 ? Math.min(1, avg / peak) : 0;
    energy = Math.pow(normalized, 0.85);
  }

  const cx = width / 2;
  const cy = height / 2;
  // Max radius reaches just past the nearest corner so rings fade off-canvas.
  const maxRadius = Math.hypot(width, height) / 2;
  if (maxRadius <= 0) return;

  const now = performance.now();
  const speed = 1 + (analysis?.treble ?? 0) * 0.18 + (analysis?.beat ? 0.16 : 0);
  const phase = ((now * speed) % RING_CYCLE_MS) / RING_CYCLE_MS; // 0..1

  ctx.save();
  ctx.strokeStyle = theme.palette[0] ?? theme.accentColor;
  ctx.lineWidth = Math.max(1, BASE_STROKE + energy * 4 + (analysis?.beat ? 2 : 0));

  // Shadow pass (alpha capped at 0.14) — wider ring strokes for a soft glow.
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < RING_COUNT; i++) {
    const ringPhase = (phase + i / RING_COUNT) % 1;
    const radius = ringPhase * ringPhase * maxRadius;
    if (radius < 1) continue;
    const visibility = (1 - ringPhase) * (0.3 + energy * 0.6);
    if (visibility <= 0) continue;
    ctx.globalAlpha = Math.min(0.14, visibility * 0.35);
    ctx.lineWidth += 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth -= 3;
  }

  // Main pass (alpha 0.75) — crisp rings.
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < RING_COUNT; i++) {
    const ringPhase = (phase + i / RING_COUNT) % 1;
    const radius = ringPhase * ringPhase * maxRadius;
    if (radius < 1) continue;
    const visibility = (1 - ringPhase) * (0.3 + energy * 0.6);
    if (visibility <= 0) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center pulse: a filled disc whose radius tracks energy.
  const coreRadius = Math.max(theme.barMinHeight, energy * Math.min(width, height) * 0.08 * (analysis?.beat ? 1.22 : 1));
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = theme.palette[0] ?? theme.accentColor;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = theme.palette[0] ?? theme.accentColor;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}
