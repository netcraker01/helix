<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from '@i18n';
  import { formatMs, formatMsPhrase } from '../utils/formatTime';
  import { Volume2, VolumeX } from 'lucide-svelte';
  import { isSilent, setSilent } from '../utils/focusAlert';
  import type { FocusSession, FocusSessionState } from '@features/focus/types';

  export let session: FocusSession;
  export let loading = false;
  export let onPause: () => void = () => {};
  export let onResume: () => void = () => {};
  export let onSkip: () => void = () => {};
  export let onEnd: () => void = () => {};
  export let onQuickNote: () => void = () => {};
  export let onDistraction: () => void = () => {};

  let now = Date.now();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let silentMode = isSilent();

  const pausedStates: FocusSessionState[] = ['pausedWork', 'pausedBreak'];
  $: isPaused = pausedStates.includes(session.state);

  $: remainingMs = isPaused
    ? (session.pausedRemainingMs ?? 0)
    : session.phaseDeadlineAt == null
      ? 0
      : session.phaseDeadlineAt - now;

  // Circular timer geometry
  const RADIUS = 160;
  const STROKE = 10;
  const SIZE = 2 * (RADIUS + STROKE);
  const CENTER = RADIUS + STROKE;
  const CIRC = 2 * Math.PI * RADIUS;

  function phaseDurationMs(): number {
    if (session.phase === 'break') return session.cadence.breakDurationMs;
    return session.cadence.workDurationMs;
  }

  function totalPlannedMs(): number {
    const c = session.cadence;
    return c.workDurationMs * c.rounds + c.breakDurationMs * Math.max(0, c.rounds - 1);
  }

  function elapsedTotalMs(): number {
    const phaseDuration = phaseDurationMs();
    const phaseElapsed = phaseDuration - Math.max(0, remainingMs);
    const completedRounds = session.round - 1;
    const completedBreaks = Math.max(0, session.round - 1);
    return (
      completedRounds * session.cadence.workDurationMs +
      completedBreaks * session.cadence.breakDurationMs +
      phaseElapsed
    );
  }

  $: phaseProgress = (() => {
    const duration = phaseDurationMs();
    if (duration <= 0) return 100;
    const pct = ((duration - remainingMs) / duration) * 100;
    return Math.max(0, Math.min(100, pct));
  })();

  $: totalProgress = (() => {
    const total = totalPlannedMs();
    if (total <= 0) return 100;
    const pct = (elapsedTotalMs() / total) * 100;
    return Math.max(0, Math.min(100, pct));
  })();

  $: circleOffset = CIRC * (1 - phaseProgress / 100);

  function phaseInstruction(state: FocusSessionState, phase: string): string {
    if (state.startsWith('paused')) return `focus.active.instruction_paused_${phase.toLowerCase()}`;
    if (phase === 'break') return 'focus.active.instruction_break';
    return 'focus.active.instruction_work';
  }

  function musicLabel(): string {
    const s = session.musicStrategy;
    switch (s.kind) {
      case 'continueCurrent':
        return $t('focus.active.music_continue');
      case 'preset':
        return $t('focus.active.music_preset', { name: s.value });
      case 'query':
        return $t('focus.active.music_query', { query: s.value });
      default:
        return $t('focus.active.music_none');
    }
  }

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

<section class="active-session" aria-label={$t('focus.active.title')}>
  <div class="session-header">
    <div class="header-row">
      <p class="intention">{session.intention}</p>
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
    {#if session.goal}
      <p class="goal">{session.goal}</p>
    {/if}
  </div>

  <div class="clock-card">
    <span class="phase-badge" class:break={session.phase === 'break'}>
      {session.phase === 'break' ? $t('focus.active.phase_break') : $t('focus.active.phase_work')}
    </span>
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
          stroke={session.phase === 'break' ? '#10b981' : 'var(--color-accent, #6366f1)'}
          stroke-width={STROKE}
          stroke-linecap="round"
          stroke-dasharray={CIRC}
          stroke-dashoffset={circleOffset}
          transform="rotate(-90 {CENTER} {CENTER})"
          class="timer-progress"
        />
      </svg>
      <div class="timer-content">
        <time class="clock" aria-live="polite">{formatMs(Math.max(0, remainingMs))}</time>
      </div>
    </div>
    <p class="instruction">{$t(phaseInstruction(session.state, session.phase))}</p>
  </div>

  <div class="progress-bars">
    <div class="progress-row">
      <span class="progress-label">
        {$t('focus.active.phase_progress', { round: session.round, rounds: session.cadence.rounds })}
      </span>
      <span class="progress-value">{Math.round(phaseProgress)}%</span>
    </div>
    <div class="progress-track" aria-hidden="true">
      <div class="progress-fill phase" style="width: {phaseProgress}%"></div>
    </div>

    <div class="progress-row">
      <span class="progress-label">{$t('focus.active.total_progress')}</span>
      <span class="progress-value">{formatMsPhrase(totalPlannedMs() - Math.max(0, remainingMs))} / {formatMsPhrase(totalPlannedMs())}</span>
    </div>
    <div class="progress-track" aria-hidden="true">
      <div class="progress-fill total" style="width: {totalProgress}%"></div>
    </div>
  </div>

  {#if session.musicStrategy.kind !== 'none'}
    <div class="music-row">
      <span class="music-label">{$t('focus.active.music_label')}</span>
      <span class="music-value">{musicLabel()}</span>
    </div>
  {/if}

  <div class="controls">
    <button
      type="button"
      class="control-btn primary"
      on:click={() => (isPaused ? onResume() : onPause())}
      disabled={loading}
    >
      {isPaused ? $t('focus.active.resume') : $t('focus.active.pause')}
    </button>

    <button
      type="button"
      class="control-btn"
      on:click={() => onQuickNote()}
      disabled={loading}
    >
      {$t('focus.active.quick_note')}
    </button>

    <button
      type="button"
      class="control-btn"
      on:click={() => onDistraction()}
      disabled={loading}
    >
      {$t('focus.active.distraction')}
    </button>

    <button
      type="button"
      class="control-btn"
      on:click={() => onSkip()}
      disabled={loading}
    >
      {$t('focus.active.skip')}
    </button>

    <button
      type="button"
      class="control-btn end"
      on:click={() => onEnd()}
      disabled={loading}
    >
      {$t('focus.active.end')}
    </button>
  </div>
</section>

<style>
  .active-session {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    max-width: 560px;
    text-align: center;
  }

  .session-header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: 100%;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .intention {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
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
    border-color: var(--color-accent, #6366f1);
    background: var(--bg-elevated, #1f2937);
  }

  .goal {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-secondary, #9ca3af);
  }

  .clock-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem;
    border-radius: var(--jellyx-radius-lg, 24px);
    background: var(--bg-surface, #111827);
    border: 1px solid var(--border-color, #1f2937);
    width: 100%;
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
    gap: 0.5rem;
    pointer-events: none;
  }

  .phase-badge {
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent, #6366f1) 20%, var(--bg-elevated, #1f2937));
    color: var(--text-primary, #e0e0e0);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .phase-badge.break {
    background: color-mix(in srgb, #10b981 20%, var(--bg-elevated, #1f2937));
    color: #a7f3d0;
  }

  .clock {
    font-size: 4.5rem;
    font-weight: 300;
    line-height: 1;
    color: var(--text-primary, #e0e0e0);
    font-variant-numeric: tabular-nums;
  }

  .instruction {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
  }

  .progress-bars {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .progress-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
  }

  .progress-track {
    height: 6px;
    border-radius: 999px;
    background: var(--bg-elevated, #1f2937);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 1s linear;
  }

  .progress-fill.phase {
    background: var(--color-accent, #6366f1);
  }

  .progress-fill.total {
    background: color-mix(in srgb, var(--color-accent, #6366f1) 60%, #a78bfa);
  }

  .music-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
  }

  .music-value {
    color: var(--text-primary, #e0e0e0);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
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
    border-color: var(--color-accent, #6366f1);
    background: var(--bg-elevated, #1f2937);
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-btn.primary {
    background: var(--color-accent, #6366f1);
    border-color: var(--color-accent, #6366f1);
    color: #ffffff;
  }

  .control-btn.end {
    color: var(--color-error, #ef4444);
    border-color: var(--color-error, #ef4444);
  }

  .control-btn.end:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.12);
  }

  .control-btn:focus-visible {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 2px;
  }
</style>
