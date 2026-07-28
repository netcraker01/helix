/**
 * Shared types for visualizer renderers and the registry.
 *
 * Renderers are pure Canvas2D functions — they receive everything they need
 * as arguments and hold no state. This keeps them safe to hot-swap from the
 * single requestAnimationFrame loop in `Visualizer.svelte` and easy to unit
 * test with a stub 2D context.
 */
import type { FrequencyData } from '@shared/types/models';
import type { SpectrumAnalysis } from './analyzeSpectrum';

/** Theme tokens resolved from CSS custom properties and user settings by the host. */
export interface VisualizerTheme {
  /** Accent color (CSS var `--viz-color-accent`). */
  accentColor: string;
  /** Gap between bars in pixels (CSS var `--viz-bar-gap`). */
  barGap: number;
  /** Minimum bar height in pixels (CSS var `--viz-bar-min-height`). */
  barMinHeight: number;
  /**
   * Uniform color palette for the visualizer. The first color is the primary
   * color used by every renderer; the optional second color is used by modes
   * that need a secondary hue (e.g. aurora rotation). The host derives these
   * from the user's fixed color or the current aurora hue per frame.
   */
  palette: [string, string?];
  /**
   * User-facing reactivity (0.5..2.0, default ~1.0). Controls how fast the
   * visualizer responds to changes in the audio — higher values reduce
   * smoothing so bars snap to the sound; lower values increase smoothing
   * for a gentler, slower visual. This is an interpolation-speed control,
   * NOT a gain/saturation multiplier.
   */
  reactivity: number;
}

/** Signature every renderer must implement. */
export type VisualizerRenderer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: FrequencyData | null,
  theme: VisualizerTheme,
  analysis?: SpectrumAnalysis
) => void;
