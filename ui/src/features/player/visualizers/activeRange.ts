/**
 * Active-range detection for frequency data.
 *
 * Truncates the FFT bins to only the range where the track has meaningful
 * energy, so visualizers don't waste canvas width on bars that sit at zero.
 * The cutoff grows immediately and shrinks only after sustained inactivity.
 *
 * Each visualizer must create its own instance via `createActiveRange()` so
 * the cutoff state is independent per component.
 */
import type { FrequencyData } from '@shared/types/models';

/** Highest frequency to consider (Hz). */
const MAX_VISUAL_FREQ_HZ = 8_000;

/** Minimum fraction of the peak magnitude for a bin to count as "active". */
const ACTIVE_THRESHOLD = 0.08;

/** Ignore low-level analyser noise that would keep high bins active forever. */
const ACTIVE_FLOOR = 0.03;

/** Extra bins to keep after the last active bin. */
const ACTIVE_BUFFER_BINS = 4;

/** Minimum bins to always keep. */
const MIN_BINS = 8;

const CUTOFF_REFRESH_FRAMES = 30;
const SHRINK_HOLD_CYCLES = 6;

export interface ActiveRangeState {
  stableCutoff: number;
  lastTrackId: string | null;
  initialized: boolean;
  frameCounter: number;
  cachedMaxIndex: number;
  shrinkHoldCounter: number;
  result: FrequencyData;
}

/**
 * Create an independent active-range instance with its own cutoff state.
 * Call once per visualizer component.
 */
export function createActiveRange(): ActiveRangeState {
  return {
    stableCutoff: 0,
    lastTrackId: null,
    initialized: false,
    frameCounter: 0,
    cachedMaxIndex: 0,
    shrinkHoldCounter: 0,
    result: { bins: new Float32Array(0), sampleRate: 0, peak: 0 },
  };
}

/**
 * Truncate frequency data to the active range of the current track.
 *
 * @param state    Mutable state for this instance (stableCutoff, lastTrackId).
 * @param data     Raw FFT frequency data.
 * @param trackId  Optional track identifier — passing a new value resets the cutoff.
 * @returns        A reused FrequencyData view truncated to the active range.
 */
export function limitFrequencyRange(
  state: ActiveRangeState,
  data: FrequencyData,
  trackId?: string
): FrequencyData {
  // Reset cutoff on track change. On first call (initialized=false), always
  // calculate so the cutoff is set even if trackId is undefined.
  const trackChanged = !state.initialized || trackId !== state.lastTrackId;
  if (trackChanged) {
    state.lastTrackId = trackId ?? null;
    state.stableCutoff = 0;
    state.initialized = true;
    state.frameCounter = 0;
    state.shrinkHoldCounter = 0;
  }

  const nyquist = data.sampleRate > 0 ? data.sampleRate / 2 : 22_050;
  const cappedHz = Math.min(MAX_VISUAL_FREQ_HZ, nyquist);
  const maxIndex = Math.max(
    1,
    Math.min(
      data.bins.length,
      Math.ceil((cappedHz / nyquist) * data.bins.length)
    )
  );

  if (maxIndex !== state.cachedMaxIndex) {
    state.cachedMaxIndex = maxIndex;
    state.frameCounter = 0;
  }

  const shouldRecompute = trackChanged
    || state.frameCounter === 0
    || state.frameCounter >= CUTOFF_REFRESH_FRAMES;
  state.frameCounter = shouldRecompute ? 1 : state.frameCounter + 1;

  if (shouldRecompute) {
    let peak = 0;
    let lastActiveBin = 0;
    for (let index = 0; index < maxIndex; index++) peak = Math.max(peak, data.bins[index]);
    const threshold = peak * ACTIVE_THRESHOLD;
    for (let index = 0; index < maxIndex; index++) {
      if (data.bins[index] >= threshold && data.bins[index] >= ACTIVE_FLOOR) lastActiveBin = index;
    }

    const target = Math.min(maxIndex, Math.max(MIN_BINS, lastActiveBin + ACTIVE_BUFFER_BINS));
    if (target > state.stableCutoff) {
      state.stableCutoff = target;
      state.shrinkHoldCounter = 0;
    } else if (target < state.stableCutoff && ++state.shrinkHoldCounter >= SHRINK_HOLD_CYCLES) {
      state.stableCutoff = target;
      state.shrinkHoldCounter = 0;
    }
  }

  const bins = data.bins.subarray(0, state.stableCutoff);
  let peak = 0;
  for (let index = 0; index < bins.length; index++) {
    peak = Math.max(peak, bins[index]);
  }

  state.result.bins = bins;
  state.result.sampleRate = data.sampleRate;
  state.result.peak = peak;
  return state.result;
}
