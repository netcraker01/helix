<script lang="ts">
  /**
   * Bars visualizer for the NowPlaying page.
   *
   * Uses the shared `renderBars` renderer with the full `VisualizerTheme`
   * (palette from `vizColor`/`vizColorMode`/`auroraSpeed`/`auroraBeatMode`),
   * `visualizerReactivity`, and `analyzeSpectrum` — exactly like
   * `Visualizer.svelte` does for fullscreen, but locked to bars mode with no
   * mode selector or chrome controls.
   *
   * Canvas sizing, rAF loop, ResizeObserver, and the WebKit context fallback
   * pattern are preserved from the previous implementation.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    frequencyData,
    currentTrack,
    vizColor,
    vizColorMode,
    auroraSpeed,
    auroraBeatMode,
    visualizerReactivity,
  } from '@features/player/stores/player';
  import { pollRemoteFftFrame, getAnalyserDriftMs, getAnalyserNode } from '@features/player/stores/remotePlayer';
  import { limitFrequencyRange, createActiveRange, type ActiveRangeState } from '@features/player/visualizers/activeRange';
  import { analyzeSpectrum } from '@features/player/visualizers/analyzeSpectrum';
  import { renderBars } from '@features/player/visualizers/bars';
  import type { FrequencyData } from '@shared/types/models';
  import type { VisualizerTheme } from '@features/player/visualizers/types';

  let canvas: HTMLCanvasElement;
  let rafId: number | null = null;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let ro: ResizeObserver | null = null;

  const activeRange: ActiveRangeState = createActiveRange();

  // ── Cached reactive values for the rAF hot path ───────────────────
  // Reading `$store` inside the rAF loop triggers Svelte dependency
  // tracking on every frame. We mirror the stores into plain locals and
  // read the locals inside renderFrame so the rAF loop is reactivity-free.
  let cachedTrackId: string | undefined = undefined;
  let cachedReactivity = 1;
  let cachedColorMode: 'fixed' | 'aurora' = 'fixed';
  let cachedVizColor = '#7c3aed';
  let cachedAuroraSpeed = 1;
  let cachedAuroraBeatMode = false;
  $: cachedTrackId = $currentTrack?.id;
  $: cachedReactivity = $visualizerReactivity;
  $: cachedColorMode = $vizColorMode;
  $: cachedVizColor = $vizColor;
  $: cachedAuroraSpeed = $auroraSpeed;
  $: cachedAuroraBeatMode = $auroraBeatMode;

  // NowPlayingVisualizer is only mounted on the /now-playing route (inside
  // the NowPlaying Page's {#if $currentTrack && !$modoCineActive} block), so
  // route and modo-cine visibility are already handled by the mount/unmount
  // boundary. We only need to guard the rAF work against the tab being
  // hidden, which is checked in renderFrame.

  // ── FPS + timing diagnostics (zero-allocation) ────────────────────
  let diagFps = 0;
  let diagDrift = 0;
  let diagPeak = 0;
  let diagFrameMs = 0;
  let diagPrevTime = 0;
  // Simple counter-based FPS: count frames over a 1s sliding window.
  const FPS_WINDOW_MS = 1000;
  let fpsCount = 0;
  let fpsWindowStart = 0;

  // ── Hidden diagnostic toggle: press Shift 5× to show/hide overlay ──
  let diagVisible = false;
  let shiftPressCount = 0;
  let shiftPressTimer: ReturnType<typeof setTimeout> | undefined;

  function handleShiftKey(): void {
    shiftPressCount++;
    clearTimeout(shiftPressTimer);
    shiftPressTimer = setTimeout(() => { shiftPressCount = 0; }, 1500);
    if (shiftPressCount >= 5) {
      diagVisible = !diagVisible;
      shiftPressCount = 0;
    }
  }

  let cachedCtx: CanvasRenderingContext2D | null = null;

  function getCtx(): CanvasRenderingContext2D | null {
    if (cachedCtx) return cachedCtx;
    try {
      cachedCtx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false,
      }) as CanvasRenderingContext2D | null;
    } catch {
      cachedCtx = null;
    }
    cachedCtx ??= canvas.getContext('2d');
    return cachedCtx;
  }

  /** Max backing-store dimensions — same as Visualizer.svelte fullscreen cap.
   *  CSS scales the bitmap up, so painting at full display resolution is wasted
   *  work for a background effect. */
  const MAX_CANVAS_WIDTH = 640;
  const MAX_CANVAS_HEIGHT = 360;

  function handleResize(): void {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    let w = Math.floor(parent.clientWidth);
    let h = Math.floor(parent.clientHeight);
    if (w === 0 || h === 0) {
      const rect = parent.getBoundingClientRect();
      w = Math.floor(rect.width);
      h = Math.floor(rect.height);
    }
    if (w > 0 && h > 0) {
      canvas.width = Math.min(w, MAX_CANVAS_WIDTH);
      canvas.height = Math.min(h, MAX_CANVAS_HEIGHT);
      cachedCtx = null;
    }
  }

  // ── Color palette computation ─────────────────────────────────────
  // Mirrors the logic in `Visualizer.svelte`: fixed mode repeats the chosen
  // color; aurora mode rotates the hue continuously, with an optional
  // beat-triggered ease-out jump. The easing progress is advanced inside the
  // rAF loop so the curve stays independent of the display refresh rate.
  const AURORA_JUMP_DEGREES_BASE = 40;
  const AURORA_JUMP_DEGREES_EASE = 40;
  const AURORA_JUMP_DURATION_MS = 500;
  const AURORA_CONTINUOUS_SPEED = 6;

  let hueOffset = 0;
  let beatJumpActive = false;
  let beatJumpStart = 0;
  let lastFrameTime = 0;
  let lastBeat = false;

  function hslFromHue(hue: number): string {
    return `hsl(${hue}, 80%, 60%)`;
  }

  function updatePalette(now: number, beat = false): [string, string?] {
    if (cachedColorMode === 'fixed') {
      return [cachedVizColor, cachedVizColor];
    }

    if (lastFrameTime === 0) lastFrameTime = now;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    hueOffset = (hueOffset + AURORA_CONTINUOUS_SPEED * cachedAuroraSpeed * dt) % 360;

    if (cachedAuroraBeatMode && beat && !lastBeat) {
      beatJumpActive = true;
      beatJumpStart = now;
    }
    lastBeat = beat;

    if (beatJumpActive) {
      const elapsed = now - beatJumpStart;
      const progress = Math.min(1, elapsed / AURORA_JUMP_DURATION_MS);
      const eased = 1 - (1 - progress) * (1 - progress);
      const jump = AURORA_JUMP_DEGREES_BASE + AURORA_JUMP_DEGREES_EASE * eased;
      if (progress >= 1) {
        beatJumpActive = false;
        hueOffset = (hueOffset + jump) % 360;
      }
      const hue1 = (hueOffset + jump) % 360;
      return [hslFromHue(hue1), hslFromHue((hue1 + 30) % 360)];
    }

    return [hslFromHue(hueOffset), hslFromHue((hueOffset + 30) % 360)];
  }

  // ── Cached theme ──────────────────────────────────────────────────
  let cachedTheme: VisualizerTheme = {
    accentColor: '#6366f1',
    barGap: 2,
    barMinHeight: 2,
    palette: ['#6366f1'],
    reactivity: 1,
  };

  function refreshTheme(palette: [string, string?] | null = null): VisualizerTheme {
    const styles = getComputedStyle(document.documentElement);
    const accentColor = styles.getPropertyValue('--viz-color-accent').trim() || '#6366f1';
    const barGap = parseInt(styles.getPropertyValue('--viz-bar-gap')) || 2;
    const barMinHeight = parseInt(styles.getPropertyValue('--viz-bar-min-height')) || 2;
    const themePalette: [string, string?] = palette ?? [accentColor, accentColor];
    const reactivity = Math.min(2, Math.max(0.5, cachedReactivity));
    cachedTheme = { accentColor, barGap, barMinHeight, palette: themePalette, reactivity };
    return cachedTheme;
  }

  function renderFrame(): void {
    if (!canvas) return;
    // Poll the remote AnalyserNode (if active) so FFT data is fresh for this
    // render frame. The guard inside pollRemoteFftFrame ensures the analyser
    // is read at most ONCE per rAF batch even when multiple visualizers call it.
    pollRemoteFftFrame();
    // Skip when the tab/window is hidden — there's no point painting into a
    // hidden surface, and skipping frees CPU for the fullscreen overlay when
    // the user has it open.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (canvas.width === 0 || canvas.height === 0) {
      handleResize();
      if (canvas.width === 0 || canvas.height === 0) return;
    }
    const ctx = getCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const fftData = get(frequencyData);
    const raw = fftData ?? { bins: new Float32Array(0), sampleRate: 44100, peak: 0 };
    const displayData = limitFrequencyRange(activeRange, raw, cachedTrackId);
    const analysis = analyzeSpectrum(displayData);
    // Per-frame palette: in fixed mode `updatePalette` is a constant-time
    // return with no `performance.now()` call. In aurora mode we fetch `now`
    // once and pass it down.
    if (cachedColorMode === 'fixed') {
      cachedTheme.palette = updatePalette(0, analysis.beat);
    } else {
      cachedTheme.palette = updatePalette(performance.now(), analysis.beat);
    }
    cachedTheme.reactivity = Math.min(2, Math.max(0.5, cachedReactivity));

    renderBars(ctx, canvas.width, canvas.height, displayData, cachedTheme, analysis);

    // ── Diagnostics overlay (zero-allocation) ─────────────────────
    // Always compute metrics so they're ready when toggled on, but only
    // draw the overlay text when diagVisible is true (Shift×5 toggle).
    const drift = getAnalyserDriftMs();
    diagPeak = fftData?.peak ?? 0;
    diagDrift = Number.isFinite(drift) ? drift : 0;

    const now = performance.now();
    fpsCount++;
    if (fpsWindowStart === 0) {
      fpsWindowStart = now;
    } else {
      const elapsed = now - fpsWindowStart;
      if (elapsed >= FPS_WINDOW_MS) {
        diagFps = Math.round(fpsCount * 1000 / elapsed);
        fpsCount = 0;
        fpsWindowStart = now;
      }
    }
    const frameTime = diagPrevTime > 0 ? now - diagPrevTime : 0;
    diagPrevTime = now;
    diagFrameMs = frameTime;

    if (diagVisible) {
      ctx.save();
      ctx.font = '11px monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(
        `${diagFps}fps  ${diagFrameMs.toFixed(0)}ms  drift:${diagDrift.toFixed(0)}ms  peak:${diagPeak.toFixed(3)}`,
        4, 4
      );
      ctx.restore();
    }
  }

  onMount(() => {
    handleResize();
    refreshTheme();
    // Hidden diagnostic toggle: press Shift 5× within 1.5s to show/hide
    // the FPS/timing overlay. The listener is on window so it works even
    // when focus is on the canvas or a parent container.
    window.addEventListener('keydown', handleShiftKey);

    // Hybrid timer: use setTimeout instead of requestAnimationFrame.
    // On this WebKitGTK/Tauri setup, the GTK frame clock drives rAF
    // at irregular intervals (16-200ms), causing visible stuttering.
    // setTimeout fires at a consistent rate regardless of the compositor.
    const FRAME_INTERVAL = 16; // ms — ~60fps
    let running = true;
    function frame(): void {
      if (!running) return;
      frameTimer = setTimeout(frame, FRAME_INTERVAL);
      renderFrame();
    }
    frameTimer = setTimeout(frame, FRAME_INTERVAL);
    // Store the cleanup flag so onDestroy can stop the loop.
    onDestroy(() => { running = false; });

    const parent = canvas?.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(parent);
    }
  });

  // Recompute the cached theme when color settings change — NOT every frame.
  // `refreshTheme` calls `getComputedStyle`, which is expensive, so it must
  // stay out of the rAF loop. The per-frame palette rotation is handled
  // inside `renderFrame` through `updatePalette`.
  $: {
    $vizColorMode;
    $vizColor;
    $auroraSpeed;
    $auroraBeatMode;
    refreshTheme(updatePalette(performance.now()));
  }
  $: {
    $visualizerReactivity;
    refreshTheme(updatePalette(performance.now()));
  }

  onDestroy(() => {
    clearTimeout(frameTimer);
    frameTimer = undefined;
    clearTimeout(shiftPressTimer);
    window.removeEventListener('keydown', handleShiftKey);
    if (ro) {
      ro.disconnect();
      ro = null;
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="nowplaying-viz" aria-hidden="true">
  <canvas bind:this={canvas} class="nowplaying-viz-canvas"></canvas>
</div>

<style>
  .nowplaying-viz {
    width: 100%;
    height: 160px;
    overflow: hidden;
  }

  .nowplaying-viz-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>