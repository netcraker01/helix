<script lang="ts">
  /**
   * Compact spectrum visualizer for the mini player.
   *
   * Consumes the shared FFT store. It does not own playback IPC, so
    * it remains accurate across route and mini-player window changes.
   */
  import { onMount, onDestroy } from 'svelte';
  import { frequencyData, currentTrack } from '@features/player/stores/player';
  import { renderBars } from '@features/player/visualizers/bars';
  import { limitFrequencyRange, createActiveRange, type ActiveRangeState } from '@features/player/visualizers/activeRange';
  import { createSpectrumAnalyzer } from '@features/player/visualizers/analyzeSpectrum';
  import { createFrameInterpolator } from '@features/player/visualizers/frameInterpolation';
  import { getCanvasContext } from '@features/player/visualizers/runtime';
  import { visualizerReactivity } from '@features/player/stores/visualizerSettings';
  import type { VisualizerTheme } from '@features/player/visualizers/types';
  import type { FrequencyData } from '@shared/types/models';

  let canvas: HTMLCanvasElement;
  let rafId: number | null = null;

  const activeRange: ActiveRangeState = createActiveRange();
  const analyze = createSpectrumAnalyzer();
  const interpolate = createFrameInterpolator(0.5);

  // Local reference to frequency data for the rAF loop (avoids reactive churn
  // inside the animation frame — same pattern as the main Visualizer).
  let currentData: FrequencyData | null = null;
  $: currentData = $frequencyData;

  // Compact theme: thinner bars and tighter gaps suit the small canvas.
  const theme: VisualizerTheme = {
    accentColor: 'var(--skin-accent, #6366f1)',
    barGap: 1,
    barMinHeight: 1,
    palette: ['#000000'],
  };

  let cachedCtx: CanvasRenderingContext2D | null = null;

  function getCtx(): CanvasRenderingContext2D | null {
    if (cachedCtx) return cachedCtx;
    cachedCtx = getCanvasContext(canvas, true);
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
      cachedCtx = null; // canvas resize resets the context
    }
  }

  function renderFrame(): void {
    if (!canvas) return;
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
    const raw = currentData ?? { bins: new Float32Array(0), sampleRate: 44100, peak: 0 };
    const rangedData = limitFrequencyRange(activeRange, raw, $currentTrack?.id);
    const data = interpolate(rangedData, $visualizerReactivity);
    const analysis = analyze(data);
    theme.reactivity = $visualizerReactivity;
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
