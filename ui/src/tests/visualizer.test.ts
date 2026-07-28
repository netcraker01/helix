/**
 * Visualizer data layer tests.
 *
 * Tests the FrequencyData type, FFT event payload conversion, and store layer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FrequencyData } from '@shared/types/models';
import { frequencyDataFromFftPayload, onFftFrame } from '@services/events';
import {
  frequencyData,
  modoCineActive,
  publishFftFrame,
  selectFftSource,
  visualizerReactivity,
} from '@features/player/stores/player';
import { analyzeSpectrum, resetSpectrumAnalysis } from '@features/player/visualizers/analyzeSpectrum';
import { reactivityToSmoothing } from '@features/player/stores/visualizerSettings';
import type { VisualizerTheme } from '@features/player/visualizers/types';

// ── FrequencyData type shape ──────────────────────────────

describe('FrequencyData type', () => {
  it('has bins as Float32Array, sampleRate, and peak fields', () => {
    const data: FrequencyData = {
      bins: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
      sampleRate: 44100,
      peak: 0.5,
    };

    expect(data.bins).toBeInstanceOf(Float32Array);
    expect(data.bins.length).toBe(5);
    expect(data.sampleRate).toBe(44100);
    expect(data.peak).toBe(0.5);
  });

  it('bins can be empty (no audio data)', () => {
    const data: FrequencyData = {
      bins: new Float32Array(0),
      sampleRate: 48000,
      peak: 0.0,
    };

    expect(data.bins).toHaveLength(0);
    expect(data.peak).toBe(0.0);
  });

  it('supports large bin arrays (FFT size 1024 = 512 bins)', () => {
    const bins = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      bins[i] = i / 512;
    }
    const data: FrequencyData = {
      bins,
      sampleRate: 44100,
      peak: 0.999,
    };

    expect(data.bins.length).toBe(512);
    expect(data.peak).toBeCloseTo(0.999);
  });

  it('bins values can be iterated directly without conversion', () => {
    const data: FrequencyData = {
      bins: new Float32Array([0.1, 0.5, 0.3]),
      sampleRate: 44100,
      peak: 0.5,
    };

    let sum = 0;
    for (let i = 0; i < data.bins.length; i++) {
      sum += data.bins[i];
    }
    expect(sum).toBeCloseTo(0.9, 5);
  });
});

// ── FFT event listener ───────────────────────────────────

describe('onFftFrame', () => {
  it('is a function that returns Promise<UnlistenFn>', async () => {
    // Browser fallback: returns no-op when Tauri unavailable
    const result = await onFftFrame(() => {});
    expect(typeof result).toBe('function');
  });

  it('is exported as the replacement for onFrequencyData', () => {
    expect(typeof onFftFrame).toBe('function');
  });
});

// ── FFT event payload conversion ──────────────────────────

describe('FFT event payload conversion', () => {
  it('converts the JSON event payload into FrequencyData', () => {
    const decoded = frequencyDataFromFftPayload({
      bins: [0.1, 0.2, 0.3, 0.4, 0.5],
      sampleRate: 44100,
      peak: 0.5,
    });

    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.peak).toBeCloseTo(0.5);
    expect(decoded.bins).toBeInstanceOf(Float32Array);
    expect(decoded.bins.length).toBe(5);
    expect(decoded.bins[0]).toBeCloseTo(0.1, 5);
    expect(decoded.bins[4]).toBeCloseTo(0.5, 5);
  });

  it('rejects legacy casing and malformed values explicitly', () => {
    expect(() => frequencyDataFromFftPayload({ bins: [0.2], sample_rate: 44_100, peak: 0.2 }))
      .toThrow(/legacy sample_rate/);
    expect(() => frequencyDataFromFftPayload({ bins: [Number.NaN], sampleRate: 44_100, peak: 0.2 }))
      .toThrow(/finite non-negative/);
  });
});

// ── FrequencyData store ──────────────────────────────────

describe('frequencyData store', () => {
  it('initializes as null', () => {
    let value: FrequencyData | null = 'not-null' as any;
    const unsub = frequencyData.subscribe((v) => { value = v; });
    expect(value).toBeNull();
    unsub();
  });

  it('updates when set with FrequencyData (Float32Array bins)', () => {
    const testData: FrequencyData = {
      bins: new Float32Array([0.1, 0.5, 0.3]),
      sampleRate: 44100,
      peak: 0.5,
    };
    frequencyData.set(testData);

    let value: FrequencyData | null = null;
    const unsub = frequencyData.subscribe((v) => { value = v; });
    expect(value).not.toBeNull();
    expect(value!.bins).toBeInstanceOf(Float32Array);
    expect(value!.bins.length).toBe(3);
    expect(value!.sampleRate).toBe(44100);
    unsub();
  });

  it('can be set back to null', () => {
    frequencyData.set({ bins: new Float32Array([0.1]), sampleRate: 44100, peak: 0.1 });
    frequencyData.set(null);

    let value: FrequencyData | null = null;
    const unsub = frequencyData.subscribe((v) => { value = v; });
    expect(value).toBeNull();
    unsub();
  });
});

describe('modoCineActive store', () => {
  it('initializes as false', () => {
    let value = true;
    const unsub = modoCineActive.subscribe((v) => { value = v; });
    expect(value).toBe(false);
    unsub();
  });

  it('can be toggled to true', () => {
    modoCineActive.set(true);

    let value = false;
    const unsub = modoCineActive.subscribe((v) => { value = v; });
    expect(value).toBe(true);
    unsub();
  });
});

describe('visualizer FFT ownership', () => {
  it('keeps both visualizer components as pure frequencyData consumers', () => {
    const visualizer = readFileSync(resolve(process.cwd(), 'src/features/player/components/Visualizer.svelte'), 'utf8');
    const miniVisualizer = readFileSync(resolve(process.cwd(), 'src/features/mini-player/MiniVisualizer.svelte'), 'utf8');

    expect(visualizer).not.toContain('onFftFrame');
    expect(miniVisualizer).not.toContain('onFftFrame');
    expect(visualizer).not.toContain('start_fft_stream');
    expect(miniVisualizer).not.toContain('start_fft_stream');
  });
});

describe('visualizer reactivity', () => {
  it('publishes bins unchanged — reactivity controls interpolation speed, not gain', () => {
    selectFftSource('remote');
    selectFftSource('local');
    visualizerReactivity.set(2);

    publishFftFrame('local', {
      bins: new Float32Array([0.2, 0.6, 1]),
      sampleRate: 44_100,
      peak: 1,
    });

    let value: FrequencyData | null = null;
    const unsub = frequencyData.subscribe((frame) => { value = frame; });
    expect(Array.from(value!.bins)).toEqual([expect.closeTo(0.2), expect.closeTo(0.6), 1]);
    unsub();
    visualizerReactivity.set(1);
  });

  it('maps low reactivity to high smoothing and high reactivity to low smoothing', () => {
    expect(reactivityToSmoothing(0.5)).toBeCloseTo(0.92);
    expect(reactivityToSmoothing(2)).toBeCloseTo(0.45);
    expect(reactivityToSmoothing(1.25)).toBeCloseTo(0.685);
  });
});

describe('spectrum analysis', () => {
  it('returns finite non-zero analysis for a realistic local FFT frame', () => {
    resetSpectrumAnalysis();
    const bins = new Float32Array(Array.from({ length: 128 }, (_, index) => 0.02 + (index % 16) / 32));
    const analysis = analyzeSpectrum({ bins, sampleRate: 48_000, peak: 0.49 });

    expect(Object.values(analysis).every((value) => typeof value === 'boolean' || Number.isFinite(value))).toBe(true);
    expect(analysis.energy).toBeGreaterThan(0);
  });

  it('extracts bass, mid, and treble bands', () => {
    resetSpectrumAnalysis();
    const bins = new Float32Array(20);
    bins.fill(0.8, 0, 3);
    bins.fill(0.4, 3, 11);
    bins.fill(0.2, 11);

    const analysis = analyzeSpectrum({ bins, sampleRate: 44_100, peak: 1 });

    expect(analysis.bass).toBeGreaterThan(analysis.mid);
    expect(analysis.mid).toBeGreaterThan(analysis.treble);
    expect(analysis.energy).toBeGreaterThan(0);
  });

  it('clamps all public bands and energy to 0..1', () => {
    const analysis = analyzeSpectrum({
      bins: new Float32Array([4, 3, 2, 5]),
      sampleRate: 44_100,
      peak: 0.25,
    });

    for (const value of [analysis.bass, analysis.mid, analysis.treble, analysis.energy]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('detects a bass spike above 1.35 times the smoothed bass energy', () => {
    resetSpectrumAnalysis();
    const baseline = new Float32Array(20).fill(0.1);
    for (let i = 0; i < 40; i++) {
      analyzeSpectrum({ bins: baseline, sampleRate: 44_100, peak: 1 });
    }
    const spike = new Float32Array(baseline);
    spike.fill(0.6, 0, 3);

    expect(analyzeSpectrum({ bins: spike, sampleRate: 44_100, peak: 1 }).beat).toBe(true);
  });
});

describe('renderer safety and enhancement contract', () => {
  const rendererNames = ['bars', 'wave', 'mirror', 'radial', 'aurora', 'grid', 'tunnel'];
  const unsafeBlurProperty = ['shadow', 'Blur'].join('');
  const unsafeComposition = new RegExp(`globalCompositeOperation\\s*=\\s*['"]${['light', 'er'].join('')}['"]`);

  it.each(rendererNames)('%s avoids unsafe canvas effects and interpolates frames', (name) => {
    const source = readFileSync(resolve(process.cwd(), `src/features/player/visualizers/${name}.ts`), 'utf8');
    expect(source).not.toContain(unsafeBlurProperty);
    expect(source).not.toMatch(unsafeComposition);
    expect(source).toContain('createFrameInterpolator');
    if (name === 'bars') {
      expect(source).toMatch(/0\.5/);
    } else {
      expect(source).toMatch(/0\.3[0-5]/);
    }
    expect(source).toContain('analysis?.beat');
    expect(source).toContain('globalAlpha = 0.75');
  });
});

// ── Renderer reactivity contract ──────────────────────────────────
// Reactivity controls interpolation speed (frameInterpolation), NOT gain.
// Renderers must normalize with `Math.min(1, magnitude / peak)` — clamp only,
// no `* reactivity` multiplication. A single-frame render on a fresh
// interpolator seeds previous bins from the input, so reactivity has no
// effect on the output magnitude of one render.

describe('renderer reactivity is interpolation speed, not gain', () => {
  const baseTheme: VisualizerTheme = {
    accentColor: '#6366f1',
    barGap: 2,
    barMinHeight: 2,
    palette: ['#6366f1'],
    reactivity: 1,
  };

  /** Minimal stub 2D context that records the max fillRect height seen. */
  function createCtx(): CanvasRenderingContext2D & { maxHeight: number } {
    const calls: number[] = [];
    const ctx = {
      maxHeight: 0,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      globalAlpha: 1,
      save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, translate() {}, rotate() {},
      fillRect(_x: number, y: number, _w: number, h: number) {
        calls.push(h);
        if (h > ctx.maxHeight) ctx.maxHeight = h;
      },
      stroke() {},
      createLinearGradient() { return { addColorStop() {} }; },
    } as unknown as CanvasRenderingContext2D & { maxHeight: number };
    return ctx;
  }

  const data = {
    bins: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2]),
    sampleRate: 44100,
    peak: 0.5,
  };

  it('bars renderer does not apply reactivity gain on a single frame', async () => {
    const { renderBars } = await import('@features/player/visualizers/bars');
    const ctx = createCtx();
    renderBars(ctx, 200, 200, data, { ...baseTheme, reactivity: 2 });
    const high = ctx.maxHeight;
    const ctx2 = createCtx();
    renderBars(ctx2, 200, 200, data, { ...baseTheme, reactivity: 0.5 });
    const low = ctx2.maxHeight;
    // Single-frame render seeds previous bins from input; reactivity only
    // affects subsequent smoothing, so magnitudes match.
    expect(high).toBeCloseTo(low, 5);
  });

  it('mirror renderer does not apply reactivity gain on a single frame', async () => {
    const { renderMirror } = await import('@features/player/visualizers/mirror');
    const ctx = createCtx();
    renderMirror(ctx, 200, 200, data, { ...baseTheme, reactivity: 2 });
    const high = ctx.maxHeight;
    const ctx2 = createCtx();
    renderMirror(ctx2, 200, 200, data, { ...baseTheme, reactivity: 0.5 });
    const low = ctx2.maxHeight;
    expect(high).toBeCloseTo(low, 5);
  });

  it('grid renderer does not apply reactivity gain on a single frame', async () => {
    const { renderGrid } = await import('@features/player/visualizers/grid');
    const ctx = createCtx();
    renderGrid(ctx, 240, 240, data, { ...baseTheme, reactivity: 2 });
    const high = ctx.maxHeight;
    const ctx2 = createCtx();
    renderGrid(ctx2, 240, 240, data, { ...baseTheme, reactivity: 0.5 });
    const low = ctx2.maxHeight;
    expect(high).toBeCloseTo(low, 5);
  });

  it('renderers use clamp-only normalization (no reactivity multiplication)', async () => {
    const { renderBars } = await import('@features/player/visualizers/bars');
    const source = readFileSync(resolve(process.cwd(), 'src/features/player/visualizers/bars.ts'), 'utf8');
    expect(source).not.toContain('* theme.reactivity');
    expect(source).toContain('Math.min(1, magnitude / peak)');

    const ctx = createCtx();
    // peak equals max bin → normalized == 1 → barHeight at the clamp ceiling.
    const saturated = {
      bins: new Float32Array([0.5, 0.5, 0.5, 0.5]),
      sampleRate: 44100,
      peak: 0.5,
    };
    renderBars(ctx, 200, 200, saturated, { ...baseTheme, reactivity: 2 });
    expect(ctx.maxHeight).toBeLessThanOrEqual(200);
  });
});
