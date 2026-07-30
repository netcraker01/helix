import type { VisualizerColorMode } from '../stores/visualizerSettings';

export interface PaletteSettings {
  color: string;
  mode: VisualizerColorMode;
  speed: number;
  beatMode: boolean;
}

export function getCanvasContext(canvas: HTMLCanvasElement, alpha: boolean): CanvasRenderingContext2D | null {
  try {
    const context = canvas.getContext('2d', {
      alpha,
      desynchronized: true,
      willReadFrequently: false,
    });
    if (context) return context;
  } catch {
    // Older WebKit builds reject Canvas2D context hints.
  }
  return canvas.getContext('2d');
}

export function createVisualizerPalette() {
  let hue = 270;
  let previousTime = 0;
  let previousBeat = false;

  return (time: number, settings: PaletteSettings, beat: boolean): readonly [string, string] => {
    if (settings.mode === 'fixed') return [settings.color, settings.color];

    if (previousTime > 0) {
      const elapsedSeconds = Math.min(0.1, Math.max(0, time - previousTime) / 1000);
      hue = (hue + elapsedSeconds * 18 * settings.speed) % 360;
    }
    if (settings.beatMode && beat && !previousBeat) hue = (hue + 40) % 360;
    previousTime = time;
    previousBeat = beat;
    return [`hsl(${hue}, 80%, 60%)`, `hsl(${(hue + 30) % 360}, 80%, 60%)`];
  };
}
