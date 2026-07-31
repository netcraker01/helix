import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createVisualizerPalette, getCanvasContext } from './runtime';
import {
  auroraSpeed,
  reactivityToSmoothing,
  setAuroraSpeed,
  setVisualizerReactivity,
  setVizColor,
  visualizerReactivity,
  vizColor,
} from '../stores/visualizerSettings';

describe('visualizer runtime', () => {
  it('falls back when WebKit rejects context hints', () => {
    const context = {} as CanvasRenderingContext2D;
    const canvas = {
      getContext: vi.fn((_type, options) => {
        if (options) throw new TypeError('unsupported options');
        return context;
      }),
    } as unknown as HTMLCanvasElement;

    expect(getCanvasContext(canvas, true)).toBe(context);
    expect(canvas.getContext).toHaveBeenCalledTimes(2);
  });

  it('returns fixed colors and advances aurora on time and beat edges', () => {
    const palette = createVisualizerPalette();
    expect(palette(0, { color: '#123456', mode: 'fixed', speed: 1, beatMode: false }, false))
      .toEqual(['#123456', '#123456']);

    const settings = { color: '#123456', mode: 'aurora' as const, speed: 1, beatMode: true };
    const initial = palette(100, settings, false);
    const advanced = palette(1100, settings, true);
    expect(initial).not.toEqual(advanced);
    expect(advanced[0]).toMatch(/^hsl\(/);
  });

  it('maps higher reactivity to lower analyser smoothing', () => {
    expect(reactivityToSmoothing(0.5)).toBeCloseTo(0.92);
    expect(reactivityToSmoothing(2)).toBeCloseTo(0.45);
  });

  it('validates colors and clamps numeric settings', () => {
    setVizColor('#112233');
    setVizColor('not-a-color');
    setAuroraSpeed(9);
    setVisualizerReactivity(-1);

    expect(get(vizColor)).toBe('#112233');
    expect(get(auroraSpeed)).toBe(2);
    expect(get(visualizerReactivity)).toBe(0.5);
  });
});
