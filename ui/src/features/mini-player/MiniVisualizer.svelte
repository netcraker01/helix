<script lang="ts">
  /**
   * Compact spectrum visualizer for the mini player.
   *
   * Consumes the shared FFT store. Always renders in black — does NOT
   * follow the user's color/aurora settings (those apply only to Now
   * Playing and fullscreen).
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { frequencyData, currentTrack, visualizerReactivity } from '@features/player/stores/player';
  import { pollRemoteFftFrame } from '@features/player/stores/remotePlayer';
  import { renderBars } from '@features/player/visualizers/bars';
  import { limitFrequencyRange, createActiveRange, type ActiveRangeState } from '@features/player/visualizers/activeRange';
  import { analyzeSpectrum } from '@features/player/visualizers/analyzeSpectrum';
  import type { VisualizerTheme } from '@features/player/visualizers/types';
  import type { FrequencyData } from '@shared/types/models';

  let canvas: HTMLCanvasElement;
  let rafId: number | null = null;

  const activeRange: ActiveRangeState = createActiveRange();

  // ── Cached reactive values for the rAF hot path ───────────────────
  // Reading `$store` inside the rAF loop triggers Svelte dependency
  // tracking on every frame. We mirror the stores into plain locals and
  // read the locals inside renderFrame so the rAF loop is reactivity-free.
  let cachedTrackId: string | undefined = undefined;
  let cachedReactivity = 1;
  $: cachedTrackId = $currentTrack?.id;
  $: cachedReactivity = $visualizerReactivity;

  // Fixed black theme — the mini visualizer never changes color.
  const theme: VisualizerTheme = {
    accentColor: '#000000',
    barGap: 1,
    barMinHeight: 1,
    palette: ['#000000'],
    reactivity: 1,
  };

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

  function handleResize(): void {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      let width = Math.floor(parent.clientWidth);
      let height = Math.floor(parent.clientHeight);
      if (width === 0 || height === 0) {
        const rect = parent.getBoundingClientRect();
        width = Math.floor(rect.width);
        height = Math.floor(rect.height);
      }
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      cachedCtx = null;
    }
  }

  function renderFrame(): void {
    if (!canvas) return;
    // Poll the remote AnalyserNode (if active) so FFT data is fresh for this
    // render frame. The guard inside pollRemoteFftFrame ensures the analyser
    // is read at most ONCE per rAF batch even when multiple visualizers call it.
    pollRemoteFftFrame();
    // Skip when the tab/window is hidden — the mini visualizer is cheap but
    // there's no point painting into a hidden surface, and skipping frees
    // CPU for the fullscreen overlay when the user has it open.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (canvas.width === 0 || canvas.height === 0) {
      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(rect.width));
        canvas.height = Math.max(1, Math.floor(rect.height));
        cachedCtx = null;
      }
      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = 80;
        canvas.height = 12;
        cachedCtx = null;
      }
    }
    const ctx = getCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const fftData = get(frequencyData);
    const raw = fftData ?? { bins: new Float32Array(0), sampleRate: 44100, peak: 0 };
    const data = limitFrequencyRange(activeRange, raw, cachedTrackId);
    const analysis = analyzeSpectrum(data);
    theme.reactivity = Math.min(2, Math.max(0.5, cachedReactivity));
    renderBars(ctx, canvas.width, canvas.height, data, theme, analysis);
  }

  let ro: ResizeObserver | null = null;

  onMount(() => {
    handleResize();
    const frame = (): void => {
      renderFrame();
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    const parent = canvas?.parentElement;
    if (parent && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(parent);
    }
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (ro) {
      ro.disconnect();
      ro = null;
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mini-viz" aria-hidden="true">
  <canvas bind:this={canvas} class="mini-viz-canvas"></canvas>
</div>

<style>
  /* iPod skin: visualizer floats in the bottom-right of the screen area */
  .mini-viz {
    position: absolute;
    right: 10px;
    bottom: 10px;
    width: 80px;
    height: 22px;
    pointer-events: none;
    overflow: hidden;
    border-radius: 3px;
  }

  .mini-viz-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Classic skin: thin borderless strip at the bottom of the screen panel */
  :global(.device[data-kind='classic']) .mini-viz {
    position: relative;
    flex: 0 0 auto;
    min-height: 12px;
    height: 13px;
    width: 100%;
    margin-top: 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: hidden;
    box-sizing: border-box;
  }
</style>