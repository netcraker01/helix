import { writable } from 'svelte/store';
import { getMigratedItem, setMigratedItem } from '@shared/utils/storage';

export type VisualizerColorMode = 'fixed' | 'aurora';

const DEFAULT_COLOR = '#7c3aed';

function readNumber(key: string, fallback: number): number {
  const raw = getMigratedItem(key);
  if (raw == null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : fallback;
}

function persisted<T>(key: string, initial: T) {
  const store = writable(initial);
  store.subscribe((value) => setMigratedItem(key, String(value)));
  return store;
}

const storedColor = getMigratedItem('viz-color');
export const vizColor = persisted(
  'viz-color',
  storedColor && /^#[0-9a-f]{6}$/i.test(storedColor) ? storedColor : DEFAULT_COLOR,
);

export const vizColorMode = persisted<VisualizerColorMode>(
  'viz-color-mode',
  getMigratedItem('viz-color-mode') === 'aurora' ? 'aurora' : 'fixed',
);

export const auroraSpeed = persisted('aurora-speed', readNumber('aurora-speed', 1));
export const auroraBeatMode = persisted('aurora-beat-mode', getMigratedItem('aurora-beat-mode') === 'true');
export const visualizerReactivity = persisted(
  'visualizer-reactivity',
  readNumber('visualizer-reactivity', 1),
);

export function setVizColor(value: string): void {
  if (/^#[0-9a-f]{6}$/i.test(value)) vizColor.set(value);
}

export function setAuroraSpeed(value: number): void {
  if (Number.isFinite(value)) auroraSpeed.set(Math.min(2, Math.max(0.5, value)));
}

export function setVisualizerReactivity(value: number): void {
  if (Number.isFinite(value)) visualizerReactivity.set(Math.min(2, Math.max(0.5, value)));
}

/** Map 0.5..2 reactivity to Web Audio's inverse 0.92..0.45 smoothing range. */
export function reactivityToSmoothing(value: number): number {
  const reactivity = Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
  return 0.92 - ((reactivity - 0.5) / 1.5) * 0.47;
}
