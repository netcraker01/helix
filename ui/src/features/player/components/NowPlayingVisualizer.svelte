<script lang="ts">
  /**
   * Bars visualizer for the NowPlaying page.
   *
   * Uses a custom renderer that skips near-zero energy bins — only bars
   * with meaningful signal fill the width. ResizeObserver for sizing,
   * same pattern as MiniVisualizer.
   */
  import { onMount, onDestroy } from 'svelte';
  import { frequencyData, currentTrack } from '@features/player/stores/player';
  import { limitFrequencyRange, createActiveRange, type ActiveRangeState } from '@features/player/visualizers/activeRange';
  import { createSpectrumAnalyzer } from '@features/player/visualizers/analyzeSpectrum';
  import { createFrameInterpolator } from '@features/player/visualizers/frameInterpolation';
  import { renderBars } from '@features/player/visualizers/bars';
  import { createVisualizerPalette, getCanvasContext } from '@features/player/visualizers/runtime';
  import {
    auroraBeatMode,
    auroraSpeed,
    visualizerReactivity,
    vizColor,
    vizColorMode,
  } from '@features/player/stores/visualizerSettings';
  import type { FrequencyData } from '@shared/types/models';
  import type { VisualizerTheme } from '@features/player/visualizers/types';

  let canvas: HTMLCanvasElement;
  let rafId: number | null = null;
  let ro: ResizeObserver | null = null;

  const activeRange: ActiveRangeState = createActiveRange();
  const analyze = createSpectrumAnalyzer();
  const interpolate = createFrameInterpolator(0.5);
  const palette = createVisualizerPalette();

  let currentData: FrequencyData | null = null;
  $: currentData = $frequencyData;

  const theme: VisualizerTheme = {
    accentColor: '#6366f1',
    barGap: 2,
    barMinHeight: 6,
  };

  let cachedCtx: CanvasRenderingContext2D | null = null;

  function getCtx(): CanvasRenderingContext2D | null {
    if (cachedCtx) return cachedCtx;
    cachedCtx = getCanvasContext(canvas, false);
    return cachedCtx;
  }

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
      canvas.width = w;
      canvas.height = h;
      cachedCtx = null;
    }
  }

  function renderFrame(time: number): void {
    if (!canvas) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (canvas.width === 0 || canvas.height === 0) {
      handleResize();
      if (canvas.width === 0 || canvas.height === 0) return;
    }
    const ctx = getCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const raw = currentData ?? { bins: new Float32Array(0), sampleRate: 44100, peak: 0 };
    const rangedData = limitFrequencyRange(activeRange, raw, $currentTrack?.id);
    const data = interpolate(rangedData, $visualizerReactivity);
    const analysis = analyze(data);
    const colors = palette(time, {
      color: $vizColor,
      mode: $vizColorMode,
      speed: $auroraSpeed,
      beatMode: $auroraBeatMode,
    }, analysis.beat);
    theme.accentColor = colors[0];
    theme.palette = colors;
    theme.reactivity = $visualizerReactivity;
    renderBars(ctx, canvas.width, canvas.height, data, theme, analysis);
  }

  onMount(() => {
    handleResize();
    const frame = (time: number): void => {
      renderFrame(time);
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    const parent = canvas?.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
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
