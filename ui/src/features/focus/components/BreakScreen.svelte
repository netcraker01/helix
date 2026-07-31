<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from '@i18n';
  import { formatMs } from '../utils/formatTime';
  import { Volume2, VolumeX } from 'lucide-svelte';
  import { isSilent, setSilent } from '../utils/focusAlert';
  import type { FocusSession } from '@features/focus/types';

  export let session: FocusSession;
  export let loading = false;
  export let onSkip: () => void = () => {};
  export let onAddTime: () => void = () => {};
  export let onEnd: () => void = () => {};

  let now = Date.now();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let silentMode = isSilent();

  $: remaining = session.state === 'pausedBreak'
    ? (session.pausedRemainingMs ?? 0)
    : session.phaseDeadlineAt == null
      ? 0
      : Math.max(0, session.phaseDeadlineAt - now);

  // Circular timer geometry
  const RADIUS = 160;
  const STROKE = 10;
  const SIZE = 2 * (RADIUS + STROKE);
  const CENTER = RADIUS + STROKE;
  const CIRC = 2 * Math.PI * RADIUS;

  $: breakProgress = (() => {
    const duration = session.cadence.breakDurationMs;
    if (duration <= 0) return 100;
    const pct = ((duration - remaining) / duration) * 100;
    return Math.max(0, Math.min(100, pct));
  })();

  $: circleOffset = CIRC * (1 - breakProgress / 100);

  function toggleSilent() {
    silentMode = !silentMode;
    setSilent(silentMode);
  }

  onMount(() => {
    intervalId = setInterval(() => {
      now = Date.now();
    }, 1000);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });
</script>

<section class="break-screen" aria-label={$t('focus.break.title')}>
  <div class="break-card">
    <div class="break-header">
      <h1>{$t('focus.break.heading')}</h1>
      <button
        type="button"
        class="silent-toggle"
        on:click={toggleSilent}
        title={silentMode ? $t('focus.active.silent_off') : $t('focus.active.silent_on')}
        aria-label={silentMode ? $t('focus.active.silent_off') : $t('focus.active.silent_on')}
      >
        {#if silentMode}
          <VolumeX size={18} color="#ffffff" />
        {:else}
          <Volume2 size={18} color="#ffffff" />
        {/if}
      </button>
    </div>
    <p class="break-message">{$t('focus.break.message')}</p>

    <div class="circular-timer" style="--size: {SIZE}px;">
      <svg viewBox="0 0 {SIZE} {SIZE}" class="timer-svg" aria-hidden="true">
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--bg-elevated, #1f2937)"
          stroke-width={STROKE}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="#10b981"
          stroke-width={STROKE}
          stroke-linecap="round"
          stroke-dasharray={CIRC}
          stroke-dashoffset={circleOffset}
          transform="rotate(-90 {CENTER} {CENTER})"
          class="timer-progress"
        />
      </svg>
      <div class="timer-content">
        <time class="clock" aria-live="polite">{formatMs(remaining)}</time>
      </div>
    </div>

    <p class="round-info">
      {$t('focus.break.round', { round: session.round, rounds: session.cadence.rounds })}
    </p>
  </div>

  <div class="controls">
    <button type="button" class="control-btn" on:click={() => onSkip()} disabled={loading}>
      {$t('focus.break.skip')}
    </button>

    <button
      type="button"
      class="control-btn"
      on:click={() => onAddTime()}
      disabled={loading}
    >
      {$t('focus.break.add_five')}
    </button>

    <button type="button" class="control-btn end" on:click={() => onEnd()} disabled={loading}>
      {$t('focus.break.end')}
    </button>
  </div>
</section>

<style>
  .break-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    width: 100%;
    min-height: 100%;
    text-align: center;
  }

  .break-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2.5rem;
    border-radius: var(--jellyx-radius-lg, 24px);
    background: var(--bg-surface, #111827);
    border: 1px solid var(--border-color, #1f2937);
    width: 100%;
    max-width: 480px;
  }

  .break-card h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: #a7f3d0;
  }

  .break-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
  }

  .silent-toggle {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: 50%;
    background: var(--bg-surface, #111827);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .silent-toggle:hover {
    border-color: #10b981;
    background: var(--bg-elevated, #1f2937);
  }

  .break-message {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-secondary, #9ca3af);
  }

  .circular-timer {
    position: relative;
    width: var(--size);
    height: var(--size);
  }

  .timer-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .timer-progress {
    transition: stroke-dashoffset 1s linear;
  }

  .timer-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .clock {
    font-size: 4.5rem;
    font-weight: 300;
    line-height: 1;
    color: var(--text-primary, #e0e0e0);
    font-variant-numeric: tabular-nums;
  }

  .round-info {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
  }

  .control-btn {
    padding: 0.6rem 1.1rem;
    border-radius: var(--jellyx-radius-md, 16px);
    border: 1px solid var(--border-color, #1f2937);
    background: var(--bg-surface, #111827);
    color: var(--text-primary, #e0e0e0);
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .control-btn:hover:not(:disabled) {
    border-color: #10b981;
    background: var(--bg-elevated, #1f2937);
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-btn.end {
    color: var(--color-error, #ef4444);
    border-color: var(--color-error, #ef4444);
  }

  .control-btn.end:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.12);
  }

  .control-btn:focus-visible {
    outline: 2px solid #10b981;
    outline-offset: 2px;
  }
</style>
