import { describe, expect, it } from 'vitest';
import { createActiveRange, limitFrequencyRange } from './activeRange';
import { createSpectrumAnalyzer } from './analyzeSpectrum';
import { renderBars } from './bars';
import { createFrameInterpolator } from './frameInterpolation';
import { renderMirror } from './mirror';
import {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerModeId,
  resolveVisualizerMode,
  VISUALIZER_MODES,
} from './registry';
import type { VisualizerTheme } from './types';

const theme: VisualizerTheme = {
  accentColor: '#6366f1',
  barGap: 2,
  barMinHeight: 2,
  palette: ['#7c3aed'],
  reactivity: 1,
};

function frame(bins: number[], peak = Math.max(...bins)): {
  bins: Float32Array;
  sampleRate: number;
  peak: number;
} {
  return { bins: new Float32Array(bins), sampleRate: 16_000, peak };
}

function recordingContext() {
  const rectangles: Array<[number, number, number, number]> = [];
  return {
    rectangles,
    context: {
      fillStyle: '',
      globalAlpha: 1,
      fillRect: (x: number, y: number, width: number, height: number) => {
        rectangles.push([x, y, width, height]);
      },
    } as unknown as CanvasRenderingContext2D,
  };
}

describe('spectrum analysis', () => {
  it('extracts ordered bands and detects a bass spike from independent state', () => {
    const analyze = createSpectrumAnalyzer();
    const baseline = new Array(20).fill(0.1);
    for (let index = 0; index < 40; index++) analyze(frame(baseline, 1));

    const bins = [...baseline];
    bins.fill(0.8, 0, 3);
    bins.fill(0.4, 3, 11);
    bins.fill(0.2, 11);
    const analysis = analyze(frame(bins, 1));

    expect(analysis.bass).toBeGreaterThan(analysis.mid);
    expect(analysis.mid).toBeGreaterThan(analysis.treble);
    expect(analysis.energy).toBeGreaterThan(0);
    expect(analysis.beat).toBe(true);
  });

  it('returns finite clamped values when peak metadata is lower than bins', () => {
    const analysis = createSpectrumAnalyzer()(frame([4, 3, 2, 5], 0.25));
    for (const value of [analysis.bass, analysis.mid, analysis.treble, analysis.energy]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('frame interpolation', () => {
  it('seeds from the first frame and applies reactivity as interpolation speed', () => {
    const interpolate = createFrameInterpolator(0.5);
    expect(Array.from(interpolate(frame([0, 1]), 1)!.bins)).toEqual([0, 1]);
    expect(Array.from(interpolate(frame([1, 0]), 0.5)!.bins)).toEqual([0.25, 0.75]);
    expect(Array.from(interpolate(frame([1, 0]), 2)!.bins)).toEqual([1, 0]);
  });

  it('reinitializes safely when FFT bin count changes', () => {
    const interpolate = createFrameInterpolator(0.5);
    interpolate(frame([0.1, 0.2]));
    expect(Array.from(interpolate(frame([0.3, 0.4, 0.5]))!.bins)).toEqual([
      expect.closeTo(0.3),
      expect.closeTo(0.4),
      0.5,
    ]);
  });
});

describe('active frequency range', () => {
  it('caps the visible spectrum at 8 kHz and resets for a new track', () => {
    const state = createActiveRange();
    const loud = frame(new Array(32).fill(0.5));
    expect(limitFrequencyRange(state, loud, 'first').bins).toHaveLength(32);

    const lowOnly = frame([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(limitFrequencyRange(state, lowOnly, 'second').bins).toHaveLength(8);
  });

  it('holds a broad cutoff until upper-band silence is sustained', () => {
    const state = createActiveRange();
    const broad = frame(new Array(32).fill(0.5));
    const lowOnly = frame([1, 1, ...new Array(30).fill(0)]);
    expect(limitFrequencyRange(state, broad, 'track').bins).toHaveLength(32);

    for (let index = 0; index < 150; index++) {
      expect(limitFrequencyRange(state, lowOnly, 'track').bins).toHaveLength(32);
    }
    for (let index = 0; index < 30; index++) limitFrequencyRange(state, lowOnly, 'track');
    expect(limitFrequencyRange(state, lowOnly, 'track').bins).toHaveLength(8);
  });
});

describe('registry and renderer contracts', () => {
  it('keeps stable registry ids and falls back to the default mode', () => {
    expect(VISUALIZER_MODES.map(({ id }) => id)).toEqual([
      'bars', 'wave', 'mirror', 'radial', 'aurora', 'grid', 'tunnel',
    ]);
    expect(isVisualizerModeId('tunnel')).toBe(true);
    expect(isVisualizerModeId('unknown')).toBe(false);
    expect(resolveVisualizerMode('unknown').id).toBe(DEFAULT_VISUALIZER_MODE);
  });

  it('redistributes bars across only active groups', () => {
    const { context, rectangles } = recordingContext();
    renderBars(context, 100, 50, frame([1, 0, 0, 1]), theme);

    expect(rectangles).toHaveLength(2);
    expect(rectangles[0][0]).toBe(0);
    expect(rectangles[1][0]).toBeCloseTo(51);
    expect(rectangles[0][2]).toBeCloseTo(49);
  });

  it('redistributes mirrored pairs and keeps them within canvas height', () => {
    const { context, rectangles } = recordingContext();
    renderMirror(context, 100, 50, frame([1, 0, 0, 1]), theme, {
      bass: 1, mid: 0, treble: 0, energy: 0.5, beat: true,
    });

    expect(rectangles).toHaveLength(4);
    expect(rectangles[0][0]).toBe(0);
    expect(rectangles[2][0]).toBeCloseTo(51);
    expect(rectangles.every(([, y, , height]) => y >= 0 && y + height <= 50)).toBe(true);
  });
});
