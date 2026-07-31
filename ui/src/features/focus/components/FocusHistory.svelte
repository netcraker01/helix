<script lang="ts">
  /**
   * Focus history — recent completed/discarded sessions.
   * Shows date, workflow, goal, duration and outcome. Allows repeating.
   */
  import { t } from '@i18n';
  import type { FocusSession } from '@features/focus/types';
  import { formatMs } from '../utils/formatTime';

  export let sessions: FocusSession[];
  export let onRepeat: (session: FocusSession) => void = () => {};
  export let onDelete: (id: string) => void = () => {};

  function formatDate(iso: number): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function totalDurationMs(s: FocusSession): number {
    return (s.cadence.workDurationMs + s.cadence.breakDurationMs) * s.cadence.rounds;
  }
</script>

<div class="focus-history">
  <h2>{$t('focus.history_title')}</h2>
  {#if sessions.length === 0}
    <p class="empty">{$t('focus.history_empty')}</p>
  {:else}
    <div class="history-list">
      {#each sessions as s (s.id)}
        <article class="history-card" data-state={s.state.toLowerCase()}>
          <div class="history-meta">
            <span class="history-date">{formatDate(s.phaseStartedAt ?? 0)}</span>
            <span class="history-duration">{formatMs(totalDurationMs(s))}</span>
          </div>
          <h3>{s.intention}</h3>
          {#if s.goal}
            <p class="history-goal">{s.goal}</p>
          {/if}
          <div class="history-footer">
            <span class="history-outcome" data-outcome={s.outcome?.toLowerCase() ?? s.state.toLowerCase()}>
              {s.outcome ?? s.state}
            </span>
            <div class="history-actions">
              <button class="repeat-btn" on:click={() => onRepeat(s)}>
                {$t('focus.repeat')}
              </button>
              <button class="delete-btn" on:click={() => onDelete(s.id)}>
                ×
              </button>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .focus-history {
    width: 100%;
    max-width: 640px;
  }

  .focus-history h2 {
    font-size: 1.1rem;
    margin: 0 0 1rem;
    color: var(--text-primary, #e0e0e0);
  }

  .empty {
    color: var(--text-secondary, #9ca3af);
    font-size: 0.9rem;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .history-card {
    padding: 0.85rem 1rem;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: 8px;
    background: var(--bg-surface, #111827);
  }

  .history-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    color: var(--text-secondary, #9ca3af);
    margin-bottom: 0.35rem;
  }

  .history-card h3 {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    color: var(--text-primary, #e0e0e0);
  }

  .history-goal {
    margin: 0 0 0.5rem;
    font-size: 0.82rem;
    color: var(--text-secondary, #9ca3af);
  }

  .history-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .history-actions {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }

  .history-outcome {
    font-size: 0.75rem;
    text-transform: capitalize;
    color: var(--text-secondary, #9ca3af);
  }

  .history-outcome[data-outcome='completed'] {
    color: #22c55e;
  }

  .history-outcome[data-outcome='discarded'] {
    color: #f59e0b;
  }

  .repeat-btn {
    border: 1px solid var(--border-color, #374151);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary, #9ca3af);
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .repeat-btn:hover {
    border-color: var(--color-accent, #6366f1);
    color: var(--text-primary, #e0e0e0);
  }

  .delete-btn {
    border: 1px solid var(--border-color, #374151);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary, #9ca3af);
    width: 1.4rem;
    height: 1.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .delete-btn:hover {
    border-color: var(--color-error, #ef4444);
    color: var(--color-error, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }
</style>