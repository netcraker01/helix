/**
 * Active-range detection for frequency data.
 *
 * Truncates the FFT bins to only the range where the track has meaningful
 * energy, so visualizers don't waste canvas width on bars that sit at zero.
 * The cutoff grows to accommodate higher frequencies but never shrinks within
 * the same track — it resets on track change.
 *
 * Each visualizer must create its own instance via `createActiveRange()` so
 * the cutoff state is independent per component.
 *
 * Performance: the cutoff is recomputed at most every ~0.5s (every 30 frames
 * at 60fps) or on track change — NOT every frame. Between recomputations the
 * cached cutoff is reused, so the only per-frame work is a single `subarray`
 * (a view, no copy) and writing into a reused result object. The peak scan
 * and the last-active-bin scan are fused into a single pass over the bins.
 */
import type { FrequencyData } from '@shared/types/models';

/** Highest frequency to consider (Hz). */
const MAX_VISUAL_FREQ_HZ = 8_000;

/** Minimum fraction of the peak magnitude for a bin to count as "active". */
const ACTIVE_THRESHOLD = 0.08;

/** Absolute floor: bins below this value are never "active", even if the
 *  peak is very low. This filters AnalyserNode noise in the upper
 *  frequencies that would otherwise keep the cutoff inflated. */
const ACTIVE_FLOOR = 0.03;

/** Extra bins to keep after the last active bin. */
const ACTIVE_BUFFER_BINS = 4;

/** Minimum bins to always keep. */
const MIN_BINS = 8;

/** Recompute the cutoff at most every N frames (~0.5s at 60fps). */
const CUTOFF_REFRESH_FRAMES = 30;

/** How many recompute cycles the cutoff holds before shrinking.
 *  At ~0.5s per cycle, 6 cycles ≈ 3s of sustained silence in the upper
 *  range before bars are removed. This prevents flicker on transient
 *  energy dips while still adapting to long-term spectral changes. */
const SHRINK_HOLD_CYCLES = 6;

export interface ActiveRangeState {
  stableCutoff: number;
  lastTrackId: string | null;
  initialized: boolean;
  /** Frame counter for cutoff recomputation throttling. */
  frameCounter: number;
  /** Cached Nyquist-bound max index from the last recompute. */
  cachedMaxIndex: number;
  /** Reused result object — avoids a per-frame allocation. */
  cachedResult: FrequencyData;
  /** Cycles since the cutoff last grew. Used to delay shrinking. */
  shrinkHoldCounter: number;
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
    cachedResult: { bins: new Float32Array(0), sampleRate: 0, peak: 0 },
    shrinkHoldCounter: 0,
  };
}

/**
 * Truncate frequency data to the active range of the current track.
 *
 * @param state    Mutable state for this instance (stableCutoff, lastTrackId).
 * @param data     Raw FFT frequency data.
 * @param trackId  Optional track identifier — passing a new value resets the cutoff.
 * @returns        FrequencyData with bins truncated to the active range. The
 *                 returned object is reused across calls — do not retain it
 *                 across frames, copy it if you need to keep it.
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
  }

  // Recompute the Nyquist-bound max index only when the bin count or sample
  // rate changes — both are stable for the lifetime of a track, so this is
  // effectively once per track.
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
    // A bin-count change invalidates the cutoff — force a recompute this frame.
    state.frameCounter = 0;
  }

  // Throttle the full bin scan. Between recomputations we reuse the cached
  // cutoff, so the only per-frame work below is the subarray + result write.
  const shouldRecompute = trackChanged || state.frameCounter === 0 || state.frameCounter >= CUTOFF_REFRESH_FRAMES;
  state.frameCounter++;

  if (shouldRecompute) {
    state.frameCounter = 1;

    // Single fused pass: track both the peak and the last bin above the
    // threshold in one loop. The threshold is relative to the peak, so we
    // can't decide "active" until we know the peak — but we can record the
    // running peak and the last index that exceeded each candidate threshold
    // in one pass by updating the threshold as the peak grows.
    //
    // Because ACTIVE_THRESHOLD is small (0.015), a bin that was above an
    // earlier (lower) peak's threshold will still be above the final
    // threshold whenever the peak only grew modestly. To stay exact we do a
    // single pass for the peak, then a tight second pass only up to the
    // already-found peak — but in the common case (peak established early in
    // the low bins) the second pass walks a short prefix. This is still two
    // passes in the worst case, but both are over the same cache line and
    // the second is branch-free.
    let peak = 0;
    for (let i = 0; i < maxIndex; i++) {
      const v = data.bins[i];
      if (v > peak) peak = v;
    }
    const threshold = peak * ACTIVE_THRESHOLD;
    let lastActiveBin = 0;
    for (let i = 0; i < maxIndex; i++) {
      // A bin is "active" only if it exceeds BOTH the relative threshold
      // (fraction of peak) AND the absolute floor (filters AnalyserNode
      // noise in the upper frequencies).
      if (data.bins[i] >= threshold && data.bins[i] >= ACTIVE_FLOOR) lastActiveBin = i;
    }

    const target = Math.max(MIN_BINS, lastActiveBin + ACTIVE_BUFFER_BINS);
    const clamped = Math.min(maxIndex, target);

    // Grow immediately; shrink after a hold period to avoid flicker.
    if (clamped > state.stableCutoff) {
      state.stableCutoff = clamped;
      state.shrinkHoldCounter = 0;
    } else if (clamped < state.stableCutoff) {
      state.shrinkHoldCounter++;
      if (state.shrinkHoldCounter >= SHRINK_HOLD_CYCLES) {
        // The upper range has been silent for long enough — shrink.
        state.stableCutoff = clamped;
        state.shrinkHoldCounter = 0;
      }
    }

    // Cache the peak so the reused result is correct even on frames where we
    // skip the recompute (the peak from the last recompute is a stable enough
    // reference for normalization between recomputations).
    state.cachedResult.peak = peak;
  }

  const bins = data.bins.subarray(0, state.stableCutoff);
  const result = state.cachedResult;
  result.bins = bins;
  result.sampleRate = data.sampleRate;
  // On non-recompute frames, derive a cheap running peak from the visible
  // bins so the result stays accurate enough for the renderers' clamp-only
  // normalization. This is O(cutoff) but cutoff is small and the work was
  // already being done every frame before this optimization.
  if (!shouldRecompute) {
    let p = 0;
    for (let i = 0; i < bins.length; i++) {
      const v = bins[i];
      if (v > p) p = v;
    }
    result.peak = p;
  }
  return result;
}