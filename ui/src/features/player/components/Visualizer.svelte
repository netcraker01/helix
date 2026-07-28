<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    frequencyData,
    modoCineActive,
    visualizerMode,
    currentTrack,
    vizColor,
    vizColorMode,
    auroraSpeed,
    auroraBeatMode,
    visualizerReactivity,
  } from '../stores/player';
  import { t } from '@i18n';
  import type { FrequencyData } from '@shared/types/models';
  import { resolveVisualizerMode, type VisualizerModeEntry } from '../visualizers/registry';
  import { limitFrequencyRange, createActiveRange, type ActiveRangeState } from '../visualizers/activeRange';
  import { analyzeSpectrum } from '../visualizers/analyzeSpectrum';
  import { pollRemoteFftFrame } from '../stores/remotePlayer';
  import type { VisualizerTheme } from '../visualizers/types';
  import VisualizerSelector from './VisualizerSelector.svelte';
  import { Palette, Zap, Settings2 } from 'lucide-svelte';

  let canvas: HTMLCanvasElement;
  let overlayEl: HTMLDivElement | null = null;
  let rafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const activeRange: ActiveRangeState = createActiveRange();

  // ── Auto-hide overlay chrome ────────────────────────────────────
  /** Whether the overlay chrome (close button + selector) is currently visible.
   *  The track title is always visible; only chrome auto-hides on mouse idle so
   *  the fullscreen view stays clean with just the visual effect and the title. */
  let controlsVisible = true;
  let lastMouseX = -1;
  let lastMouseY = -1;
  let wasModoCineActive = false;

  /** Idle timer handle for auto-hiding chrome after the mouse stops moving. */
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Delay before hiding chrome after the mouse stops moving (ms).
   *  Long enough that the user can read/aim the controls, short enough that the
   *  view returns to a clean state quickly once idle. */
  const CHROME_IDLE_DELAY = 2500;

  /** Arm/re-arm the idle timer that hides the overlay chrome. */
  function scheduleChromeHide(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controlsVisible = false;
    }, CHROME_IDLE_DELAY);
  }

  /** Pointer movement handler — only acts while the fullscreen overlay is active. */
  function handlePointerMove(e: PointerEvent): void {
    if (!$modoCineActive) return;
    // Ignore synthetic / zero-delta moves so the idle timer is not constantly
    // restarted by noisy pointer events on some WebKit/desktop setups.
    if (e.clientX === lastMouseX && e.clientY === lastMouseY) return;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    revealChrome();
  }

  /** Any pointer-down inside the overlay should also reveal chrome. */
  function handlePointerDown(): void {
    if (!$modoCineActive) return;
    revealChrome();
  }

  /** Whether the inline visualizer settings panel is open. While open, the
   *  idle-hide timer is disabled so the user can adjust controls without the
   *  chrome disappearing. */
  let settingsOpen = false;

  function openSettings(): void {
    settingsOpen = true;
    controlsVisible = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function closeSettings(): void {
    settingsOpen = false;
    scheduleChromeHide();
  }

  /** Reveal chrome, but respect the open settings panel by not starting the
   *  idle timer while the panel is open. */
  function revealChrome(): void {
    controlsVisible = true;
    if (!settingsOpen) {
      scheduleChromeHide();
    }
  }

  /** Clear the idle timer and reset chrome state (used on exit/cleanup). */
  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    controlsVisible = true;
    lastMouseX = -1;
    lastMouseY = -1;
    settingsOpen = false;
  }

  // ── Cached reactive values for the rAF hot path ───────────────────
  // Reading `$store` inside the rAF loop triggers Svelte's dependency
  // tracking on every frame, which is wasted work (the loop already runs
  // unconditionally). We mirror the stores into plain locals via reactive
  // statements and read the locals inside renderFrame. This keeps the rAF
  // loop free of Svelte reactivity.
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

  // Resolve the active renderer from the persisted mode id. Re-evaluated only
  // when the mode id changes — the rAF loop reads `activeMode` directly, so a
  // mode switch takes effect on the next frame with no effect churn.
  let activeMode: VisualizerModeEntry = resolveVisualizerMode($visualizerMode);
  $: activeMode = resolveVisualizerMode($visualizerMode);

  // ── Color palette computation ─────────────────────────────────────
  // Per-frame hue for aurora mode. In fixed mode the palette is just the
  // chosen color repeated. In aurora mode it rotates smoothly; when beat mode
  // is on, a beat adds a smooth 40°+40° ease-out jump over 500ms. The easing
  // progress is advanced inside the rAF loop so the curve stays independent
  // of the display refresh rate.
  const AURORA_JUMP_DEGREES_BASE = 40;
  const AURORA_JUMP_DEGREES_EASE = 40;
  const AURORA_JUMP_DURATION_MS = 500;
  const AURORA_CONTINUOUS_SPEED = 6; // degrees per second at speed = 1.0

  /** Current hue offset driven by continuous rotation plus any active beat jump. */
  let hueOffset = 0;
  /** Whether a beat jump is currently in flight. */
  let beatJumpActive = false;
  /** When the current beat jump started (performance.now()). */
  let beatJumpStart = 0;
  /** Time of the last frame, used to advance continuous rotation. */
  let lastFrameTime = 0;
  /** Last known beat state, used to detect rising edges. */
  let lastBeat = false;

  /**
   * Compute the palette to use this frame. Called from renderFrame so it has
   * access to the latest store values and time; the reactive declarations
   * below ensure the rAF loop re-evaluates whenever a color setting changes.
   *
   * Performance: in fixed mode the palette is constant — we return the
   * cached pair without touching `performance.now()` or any arithmetic. In
   * aurora mode the rotation is advanced using the supplied `now` (already
   * fetched once per frame by the caller).
   */
  function updatePalette(now: number, beat = false): [string, string?] {
    if (cachedColorMode === 'fixed') {
      return [cachedVizColor, cachedVizColor];
    }

    // Continuous rotation in aurora mode.
    if (lastFrameTime === 0) lastFrameTime = now;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    hueOffset = (hueOffset + AURORA_CONTINUOUS_SPEED * cachedAuroraSpeed * dt) % 360;

    // Beat-triggered hue jump: on a rising edge, start a 500ms ease-out bump.
    if (cachedAuroraBeatMode && beat && !lastBeat) {
      beatJumpActive = true;
      beatJumpStart = now;
    }
    lastBeat = beat;

    if (beatJumpActive) {
      const elapsed = now - beatJumpStart;
      const progress = Math.min(1, elapsed / AURORA_JUMP_DURATION_MS);
      // Ease-out: 1 - (1 - t)^2
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

  /** Convert a 0..360 hue to an opaque HSL CSS color string. */
  function hslFromHue(hue: number): string {
    return `hsl(${hue}, 80%, 60%)`;
  }

  // Recompute the cached theme whenever color settings change so renderers
  // pick up the new palette without resetting the canvas context.
  // NOTE: these reactive blocks run only when the listed stores change — NOT
  // every frame. `refreshTheme` reads CSS custom properties via
  // `getComputedStyle`, which is expensive, so it must stay out of the rAF
  // loop. The per-frame palette rotation is handled inside `renderFrame`
  // through `updatePalette`, which only touches the palette pair.
  $: {
    $visualizerMode;
    refreshTheme(updatePalette(performance.now()));
  }
  $: {
    $vizColorMode;
    $vizColor;
    $auroraSpeed;
    $auroraBeatMode;
    refreshTheme(updatePalette(performance.now()));
  }
  // Reactivity gain feeds the renderers' normalization; refresh the cached
  // theme so the next frame picks up the new multiplier without a full palette
  // recompute.
  $: {
    $visualizerReactivity;
    refreshTheme(updatePalette(performance.now()));
  }

  onMount(() => {
    // Initial canvas sizing and theme cache
    handleResize();
    refreshTheme();

    // Start rAF loop
    startRenderLoop();

    const parent = canvas?.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(parent);
    }

    // Escape key exits Modo Cine
    function handleKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && $modoCineActive) {
        modoCineActive.set(false);
      }
    }
    window.addEventListener('keydown', handleKeydown);

    // Start the idle countdown immediately on mount (chrome visible, then hides
    // if the mouse never moves — which is the common clean view).
    revealChrome();

    // Store cleanup for the keydown listener
    keydownHandler = handleKeydown;
  });

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  function startRenderLoop(): void {
    function frame(): void {
      rafId = requestAnimationFrame(frame);
      renderFrame();
    }
    rafId = requestAnimationFrame(frame);
  }

  /** Cache theme tokens so we don't call getComputedStyle every frame.
   *  Refreshed on mode change and on resize (theme may change with route). */
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
    // Clamp defensively: the store already clamps, but a stale cached value
    // should never produce negative/zero gain in a renderer. Read the cached
    // local, not the store, so this stays safe to call from non-reactive
    // paths (resize, mount).
    const reactivity = Math.min(2, Math.max(0.5, cachedReactivity));
    cachedTheme = { accentColor, barGap, barMinHeight, palette: themePalette, reactivity };
    return cachedTheme;
  }

  /** Max backing-store dimensions for the canvas. The visualizer is a background
   *  effect — rendering at full monitor resolution (e.g. 4K) is visually
   *  indistinguishable from 960×540 but 4-9× slower on CPU Canvas2D. CSS scales
   *  the bitmap up to fill the viewport. 960 keeps WebKitGTK (JSC JIT
   *  disabled) comfortably under 1M pixels per frame while staying crisp on
   *  most displays. */
  const MAX_CANVAS_WIDTH = 640;
  const MAX_CANVAS_HEIGHT = 360;

  /** Cached 2D context. Requested once with GPU-friendly options.
   *  Modo cine needs alpha:true so the CSS gradient background of
   *  .visualizer.modo-cine shows through the clearRect'd canvas.
   *  desynchronized:true decouples paint from the event loop for lower latency.
   *  willReadFrequently:false hints the browser to use hardware-accelerated Canvas2D. */
  let cachedCtx: CanvasRenderingContext2D | null = null;

  function getCtx(): CanvasRenderingContext2D | null {
    if (cachedCtx) return cachedCtx;
    try {
      cachedCtx = canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false,
      }) as CanvasRenderingContext2D | null;
    } catch {
      cachedCtx = null;
    }
    cachedCtx ??= canvas.getContext('2d');
    return cachedCtx;
  }

  function renderFrame(): void {
    if (!canvas) return;

    // Poll the remote AnalyserNode (if active) so FFT data is fresh for this
    // render frame. The guard inside pollRemoteFftFrame ensures the analyser
    // is read at most ONCE per rAF batch even when multiple visualizers call it.
    pollRemoteFftFrame();

    // Skip rendering when the fullscreen overlay is not active. The Visualizer
    // component is mounted inside `{#if $modoCineActive}` in App.svelte, so
    // this guard is belt-and-suspenders for the case where the store flips
    // off between rAF ticks. It also lets the rAF loop stay cheap (just the
    // clearRect) when the user exits modo cine but the component hasn't been
    // torn down yet.
    if (!$modoCineActive) return;

    // Pause work when the tab/page is hidden — document.hidden covers both
    // background tabs and the OS-level window being minimized on most
    // platforms. Skipping the heavy Canvas2D work while hidden is a major
    // CPU/battery win on Linux WebKitGTK.
    if (typeof document !== 'undefined' && document.hidden) return;

    const ctx = getCtx();
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Render only the musically-useful part of the spectrum. The raw FFT spans
    // the full Nyquist range; trimming the upper tail avoids bars/cells that
    // sit at zero most of the time and makes all visualizers feel more alive.
    // Read the latest FFT data directly from the store inside the rAF loop
    // instead of using a reactive subscriber. This eliminates the 70fps store
    // subscriber chain that can preempt the rAF callback on slow engines.
    const fftData = get(frequencyData);
    const displayData = fftData ? limitFrequencyRange(activeRange, fftData, cachedTrackId) : null;
    const analysis = analyzeSpectrum(displayData);

    // Per-frame palette: in fixed mode `updatePalette` is a constant-time
    // return with no `performance.now()` call. In aurora mode we fetch
    // `now` once and pass it down.
    if (cachedColorMode === 'fixed') {
      cachedTheme.palette = updatePalette(0, analysis.beat);
    } else {
      cachedTheme.palette = updatePalette(performance.now(), analysis.beat);
    }
    cachedTheme.reactivity = Math.min(2, Math.max(0.5, cachedReactivity));

    activeMode.render(ctx, width, height, displayData, cachedTheme, analysis);
  }

  function handleResize(): void {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      let w = parent.clientWidth;
      let h = parent.clientHeight;
      // Cap the backing store so CPU Canvas2D doesn't paint millions of
      // pixels per frame on high-DPI monitors. CSS scales the bitmap up.
      w = Math.min(w, MAX_CANVAS_WIDTH);
      h = Math.min(h, MAX_CANVAS_HEIGHT);
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      // Setting canvas.width/height resets the context — invalidate cache.
      cachedCtx = null;
    }
    refreshTheme();
  }

  onDestroy(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    clearIdleTimer();
  });

  $: if ($modoCineActive !== wasModoCineActive) {
    wasModoCineActive = $modoCineActive;
    if (!$modoCineActive) {
      // Reset chrome state when exiting fullscreen so the next entry is clean.
      clearIdleTimer();
      // Resize to parent container
      setTimeout(handleResize, 0);
    } else {
      // Resize canvas for modo cine fullscreen — the visualizer is in a
      // fixed full-viewport overlay (.visualizer-embed) inside .app-shell.
      setTimeout(() => {
        if (canvas) {
          canvas.width = Math.min(window.innerWidth, MAX_CANVAS_WIDTH);
          canvas.height = Math.min(window.innerHeight, MAX_CANVAS_HEIGHT);
          cachedCtx = null; // canvas resize resets the context
          refreshTheme();
        }
      }, 0);
      revealChrome();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="visualizer"
  class:modo-cine={$modoCineActive}
  bind:this={overlayEl}
  on:pointermove={handlePointerMove}
  on:pointerdown={handlePointerDown}
>
  <canvas bind:this={canvas} class="visualizer-canvas"></canvas>
    {#if $modoCineActive}
      <div class="track-title">
        {$currentTrack?.title ?? ''}
      </div>
        {#if controlsVisible}
          <div class="chrome-controls visible">
            <VisualizerSelector />
          </div>
          <button class="modo-cine-close" aria-label="Exit fullscreen" on:click={() => modoCineActive.set(false)}>
            ✕
          </button>
          <button class="settings-open" type="button" aria-label={$t('settings.visualizer.title')} on:click={openSettings}>
            <Settings2 size={18} />
          </button>
          {#if settingsOpen}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="viz-settings-panel" on:pointerdown={(e) => e.stopPropagation()} aria-label={$t('settings.visualizer.title')}>
          <button class="settings-close" type="button" aria-label={$t('common.close')} on:click={closeSettings}>✕</button>
          <div class="settings-header">
            <Palette size={16} />
            <span>{$t('settings.visualizer.title')}</span>
          </div>

          <label class="setting">
            <span>{$t('settings.visualizer.colorMode')}</span>
            <div class="segmented">
              <button
                type="button"
                class:active={$vizColorMode === 'fixed'}
                on:click={() => vizColorMode.set('fixed')}
              >
                {$t('settings.visualizer.colorModeOptions.fixed')}
              </button>
              <button
                type="button"
                class:active={$vizColorMode === 'aurora'}
                on:click={() => vizColorMode.set('aurora')}
              >
                {$t('settings.visualizer.colorModeOptions.aurora')}
              </button>
            </div>
          </label>

          {#if $vizColorMode === 'fixed'}
            <label class="setting">
              <span>{$t('settings.visualizer.color')}</span>
              <input
                type="color"
                value={$vizColor}
                on:input={(e) => vizColor.set(e.currentTarget.value)}
                aria-label={$t('settings.visualizer.color')}
              />
            </label>
          {/if}

          {#if $vizColorMode === 'aurora'}
            <label class="setting">
              <span>{$t('settings.visualizer.auroraBeatMode')}</span>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={$auroraBeatMode}
                  on:change={(e) => auroraBeatMode.set(e.currentTarget.checked)}
                  aria-label={$t('settings.visualizer.auroraBeatMode')}
                />
                <span class="toggle-slider"></span>
              </label>
            </label>
            <p class="hint">{$t('settings.visualizer.auroraBeatModeHint')}</p>

            <label class="setting">
              <span>{$t('settings.visualizer.auroraSpeed')}</span>
              <input
                class="slider"
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={$auroraSpeed}
                on:input={(e) => auroraSpeed.set(Number(e.currentTarget.value))}
                aria-label={$t('settings.visualizer.auroraSpeed')}
              />
            </label>
            <p class="hint">{$t('settings.visualizer.auroraSpeedHint')}</p>
          {/if}

          <label class="setting">
            <span><Zap size={14} /> {$t('settings.visualizer.reactivity')}</span>
            <input
              class="slider"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={$visualizerReactivity}
              on:input={(e) => visualizerReactivity.set(Number(e.currentTarget.value))}
              aria-label={$t('settings.visualizer.reactivity')}
            />
          </label>
          <p class="hint">{$t('settings.visualizer.reactivityHint')}</p>
          </div>
        {/if}
      {/if}
    {/if}
</div>

<style>
  .visualizer {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* Modo cine: fills the full viewport as a fullscreen overlay. The parent
     .visualizer-embed is fixed with z-index 99. */
  .visualizer.modo-cine {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background:
      radial-gradient(ellipse 80% 60% at 50% -20%, rgba(138, 92, 255, 0.12), transparent),
      radial-gradient(ellipse 60% 50% at 80% 100%, rgba(0, 229, 255, 0.08), transparent),
      var(--bg-base, #0a0a0f);
  }

  .visualizer-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* ── Track title ─────────────────────────────────────────────── */
  /* Track title and chrome controls must paint above the sidebar/content/bottombar
     (z-index: 1). They live inside .visualizer-embed (z-index: 99) so they
     are already above all app content. */
  .track-title {
    position: fixed;
    top: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    max-width: 70vw;
    color: var(--text-primary, #e0e0e0);
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-align: center;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* The title stays visible even when chrome hides — the user explicitly
       asked for the title to remain. */
    opacity: 1;
    transition: opacity 0.3s ease;
    pointer-events: none;
    /* Subtle fade-in on enter so the title doesn't pop. */
  }

  /* ── Chrome controls (close button + selector) ────────────────── */
  /* Wraps the auto-hiding controls. They fade out together when the mouse
     is idle and reappear the instant it moves. */
  .chrome-controls {
    position: fixed;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    transition: opacity 0.3s ease;
    pointer-events: none; /* allow mouse events to reach the window handler */
    visibility: visible;
  }

  .chrome-controls.visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto; /* let the VisualizerSelector receive clicks */
  }

  /* The selector and close button live inside .chrome-controls; they keep
     pointer-events: auto so they remain clickable while visible. */
  .chrome-controls :global(.viz-selector) {
    pointer-events: auto;
  }

  .modo-cine-close {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 50;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--text-primary, #e0e0e0);
    font-size: 1.25rem;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, box-shadow 0.2s;
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }

  .modo-cine-close:hover {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: 0 0 12px rgba(138, 92, 255, 0.3);
  }

  /* ── Inline visualizer settings panel ───────────────────────────── */
  .settings-open {
    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 50;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--text-primary, #e0e0e0);
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, box-shadow 0.2s;
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }

  .settings-open:hover {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: 0 0 12px rgba(138, 92, 255, 0.3);
  }

  .viz-settings-panel {
    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 51;
    width: 260px;
    max-width: calc(100vw - 2rem);
    padding: 1rem;
    background: rgba(10, 10, 15, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    backdrop-filter: blur(12px);
    color: var(--text-primary, #e0e0e0);
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .settings-close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: transparent;
    border: none;
    color: var(--text-secondary, #9ca3af);
    font-size: 1rem;
    cursor: pointer;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.2s, color 0.2s;
  }

  .settings-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #e0e0e0);
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--text-primary, #e0e0e0);
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
    cursor: pointer;
  }

  .setting span {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .setting input[type='color'] {
    appearance: none;
    -webkit-appearance: none;
    width: 2.25rem;
    height: 1.5rem;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }

  .setting input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .setting input[type='color']::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }

  .segmented {
    display: flex;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 0.2rem;
    gap: 0.2rem;
  }

  .segmented button {
    background: transparent;
    border: none;
    color: var(--text-secondary, #9ca3af);
    font-size: 0.8rem;
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .segmented button.active {
    background: var(--color-accent, #6366f1);
    color: #fff;
  }

  .segmented button:hover:not(.active) {
    background: rgba(255, 255, 255, 0.06);
  }

  .hint {
    margin: -0.5rem 0 0 0;
    font-size: 0.75rem;
    color: var(--text-secondary, #9ca3af);
    opacity: 0.8;
  }

  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100px;
    height: 4px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    cursor: pointer;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-accent, #6366f1);
  }

  .slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-accent, #6366f1);
    border: none;
  }

  /* Toggle switch (inline panel variant) */
  .toggle {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    cursor: pointer;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 11px;
    transition: background 0.2s, border-color 0.2s;
  }

  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    left: 2px;
    bottom: 2px;
    background: var(--text-secondary, #9ca3af);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }

  .toggle input:checked + .toggle-slider {
    background: var(--color-accent, #6366f1);
    border-color: var(--color-accent, #6366f1);
  }

  .toggle input:checked + .toggle-slider::before {
    transform: translateX(18px);
    background: white;
  }
</style>
