<script lang="ts">
  import { t } from '@i18n';
  import type { FocusSession } from '@features/focus/types';

  export let session: FocusSession;
  export let onSave: () => void = () => {};
  export let onRepeat: () => void = () => {};
  export let onHome: () => void = () => {};

  function advanceLabel(firstAction: string): string {
    return firstAction.trim() || $t('focus.summary.next_default');
  }

  $: notes = (session.captures ?? []).filter((c) => c.kind === 'note');
  $: distractions = (session.captures ?? []).filter((c) => c.kind === 'distraction');
  $: totalBreaks = session.cadence.rounds > 1 ? session.cadence.rounds - 1 : 0;
  $: completedBreaks = Math.min(session.round - 1, totalBreaks);
</script>

<section class="summary-screen" aria-label={$t('focus.summary.title')}>
  <div class="summary-card">
    <h1>{$t('focus.summary.heading')}</h1>

    <div class="summary-block">
      <h2>{$t('focus.summary.advance')}</h2>
      <p class="advance">{session.intention}</p>
      {#if session.goal}
        <p class="detail">{session.goal}</p>
      {/if}
    </div>

    <div class="summary-block">
      <h2>{$t('focus.summary.pending')}</h2>
      <p class="detail">
        {$t('focus.summary.pending_detail', {
          round: session.round,
          rounds: session.cadence.rounds,
        })}
      </p>
    </div>

    <div class="summary-block">
      <h2>{$t('focus.summary.breaks')}</h2>
      <p class="detail">
        {$t('focus.summary.breaks_detail', {
          completed: completedBreaks,
          total: totalBreaks,
        })}
      </p>
    </div>

    {#if notes.length > 0}
      <div class="summary-block">
        <h2>{$t('focus.summary.notes')}</h2>
        <ul class="capture-list">
          {#each notes as note}
            <li class="note">{note.body}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if distractions.length > 0}
      <div class="summary-block">
        <h2>{$t('focus.summary.distractions')}</h2>
        <ul class="capture-list">
          {#each distractions as d}
            <li class="distraction">{d.body}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="summary-block next">
      <h2>{$t('focus.summary.next')}</h2>
      <p class="advance">{advanceLabel(session.firstAction)}</p>
    </div>
  </div>

  <div class="controls">
    <button type="button" class="control-btn primary" on:click={onSave}>
      {$t('focus.summary.save')}
    </button>

    <button type="button" class="control-btn" on:click={onRepeat}>
      {$t('focus.summary.repeat')}
    </button>

    <button type="button" class="control-btn" on:click={onHome}>
      {$t('focus.summary.home')}
    </button>
  </div>
</section>

<style>
  .summary-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    width: 100%;
    min-height: 100%;
    text-align: center;
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 2rem;
    border-radius: var(--jellyx-radius-lg, 24px);
    background: var(--bg-surface, #111827);
    border: 1px solid var(--border-color, #1f2937);
    width: 100%;
    max-width: 520px;
  }

  .summary-card h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .summary-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color, #1f2937);
  }

  .summary-block:last-of-type {
    border-bottom: none;
    padding-bottom: 0;
  }

  .summary-block h2 {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary, #9ca3af);
  }

  .advance {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--text-primary, #e0e0e0);
  }

  .detail {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-secondary, #9ca3af);
  }

  .summary-block.next {
    padding: 0.75rem;
    border-radius: var(--jellyx-radius-md, 16px);
    background: color-mix(in srgb, var(--color-accent, #6366f1) 10%, var(--bg-elevated, #1f2937));
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
  }

  .control-btn {
    padding: 0.6rem 1.25rem;
    border-radius: var(--jellyx-radius-md, 16px);
    border: 1px solid var(--border-color, #1f2937);
    background: var(--bg-surface, #111827);
    color: var(--text-primary, #e0e0e0);
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .control-btn:hover {
    border-color: var(--color-accent, #6366f1);
    background: var(--bg-elevated, #1f2937);
  }

  .control-btn.primary {
    background: var(--color-accent, #6366f1);
    border-color: var(--color-accent, #6366f1);
    color: #ffffff;
  }

  .control-btn:focus-visible {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 2px;
  }

  .capture-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: left;
  }

  .capture-list li {
    padding: 0.55rem 0.75rem;
    border-radius: var(--jellyx-radius-sm, 12px);
    background: var(--bg-elevated, #1f2937);
    color: var(--text-secondary, #9ca3af);
    font-size: 0.9rem;
    word-break: break-word;
  }

  .capture-list li.note {
    border-left: 3px solid var(--color-accent, #6366f1);
  }

  .capture-list li.distraction {
    border-left: 3px solid #f59e0b;
  }
</style>
