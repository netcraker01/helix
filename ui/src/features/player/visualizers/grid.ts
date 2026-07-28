/**
 * Grid visualizer renderer — a matrix of cells lit by spectrum energy.
 *
 * Maps the spectrum onto a 2D grid: columns correspond to frequency bin
 * groups (low → high, left → right) and rows correspond to amplitude tiers.
 * Each cell's brightness reflects how strongly its bin group exceeds the
 * row's amplitude threshold, producing a heatmap-style "equalizer grid"
 * that is visually distinct from the linear bar / radial / aurora modes.
 *
 * Pure Canvas2D layered cell passes with bounded interpolation state. Safe for
 * the WebKitGTK (JSC JIT disabled) dev runtime.
 */
import type { FrequencyData } from '@shared/types/models';
import type { VisualizerTheme } from './types';
import type { SpectrumAnalysis } from './analyzeSpectrum';
import { createFrameInterpolator } from './frameInterpolation';

const interpolateFrame = createFrameInterpolator(0.35);

/** Fixed grid geometry. Kept small so cell count stays bounded on any canvas. */
const GRID_COLUMNS = 24;
const GRID_ROWS = 12;

/**
 * Render a spectrum heatmap grid.
 *
 * @param ctx      Canvas 2D context (already cleared by the host).
 * @param width    Canvas pixel width.
 * @param height   Canvas pixel height.
 * @param data     Latest frequency data (bins + peak), may be empty while idle.
 * @param theme    Resolved theme tokens (accent color, gaps, min heights).
 */
export function renderGrid(
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
  const columns = Math.min(GRID_COLUMNS, bins.length);
  const groupSize = Math.ceil(bins.length / columns);

  const gap = Math.max(1, theme.barGap);
  const cellW = Math.max(1, (width - gap * (columns + 1)) / columns);
  const cellH = Math.max(1, (height - gap * (GRID_ROWS + 1)) / GRID_ROWS);

  ctx.save();
  ctx.fillStyle = theme.palette[0] ?? theme.accentColor;

  // Three-pass rendering to batch canvas state changes. Lit cells have a
  // shadow (alpha 0.14) and main fill (alpha 0.75); dim cells are alpha 0.06.
  // Batching per alpha reduces state changes from 3×cellCount to just 3.

  // Pre-compute column metadata: lit rows from bottom.
  const colLitRows = new Uint8Array(columns);
  for (let col = 0; col < columns; col++) {
    colLitRows[col] = litRowsAt(col, bins, peak, analysis, groupSize);
  }

  // Pass 1: lit cell shadows (alpha 0.14).
  ctx.globalAlpha = 0.14;
  for (let col = 0; col < columns; col++) {
    const litRowsCount = colLitRows[col];
    if (litRowsCount === 0) continue;
    const x = gap + col * (cellW + gap);
    for (let row = 0; row < GRID_ROWS; row++) {
      if (GRID_ROWS - 1 - row < litRowsCount) {
        const y = gap + row * (cellH + gap);
        ctx.fillRect(x - 1, y - 1, cellW + 2, cellH + 2);
      }
    }
  }

  // Pass 2: lit cell mains (alpha 0.75).
  ctx.globalAlpha = 0.75;
  for (let col = 0; col < columns; col++) {
    const litRowsCount = colLitRows[col];
    if (litRowsCount === 0) continue;
    const x = gap + col * (cellW + gap);
    for (let row = 0; row < GRID_ROWS; row++) {
      if (GRID_ROWS - 1 - row < litRowsCount) {
        const y = gap + row * (cellH + gap);
        ctx.fillRect(x, y, cellW, cellH);
      }
    }
  }

  // Pass 3: dim cells (alpha 0.06).
  ctx.globalAlpha = 0.06;
  for (let col = 0; col < columns; col++) {
    const litRowsCount = colLitRows[col];
    if (litRowsCount >= GRID_ROWS) continue;
    const x = gap + col * (cellW + gap);
    for (let row = 0; row < GRID_ROWS - litRowsCount; row++) {
      // Top rows (not lit) — iterate from top to skip lit rows.
      const r = row; // row 0 = top, already "from top"
      const y = gap + r * (cellH + gap);
      ctx.fillRect(x, y, cellW, cellH);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function litRowsAt(
  col: number,
  bins: Float32Array,
  peak: number,
  analysis: SpectrumAnalysis | undefined,
  groupSize: number,
): number {
  const groupStart = col * groupSize;
  const groupEnd = Math.min((col + 1) * groupSize, bins.length);
  let sum = 0;
  let count = 0;
  for (let j = groupStart; j < groupEnd; j++) {
    sum += bins[j];
    count++;
  }
  const magnitude = count > 0 ? sum / count : 0;
  const normalized = peak > 0 ? Math.min(1, magnitude / peak) : 0;
  const shaped = Math.pow(normalized, 0.85);
  const punch = 1 + (analysis?.mid ?? 0) * 0.08 + (analysis?.beat ? 0.16 : 0);
  return Math.min(GRID_ROWS, Math.floor(shaped * punch * GRID_ROWS + 0.5));
}
