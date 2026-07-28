<script lang="ts">
  import type { FocusCadence, FocusWorkflow } from '@features/focus/types';

  export let workflow: FocusWorkflow;
  export let name: string;
  export let description: string;
  export let cadence: FocusCadence;
  export let musicHint: string;
  export let selected = false;
  export let onSelect: (workflow: FocusWorkflow) => void = () => {};

  function formatMs(ms: number): string {
    const minutes = Math.round(ms / 60000);
    return `${minutes}m`;
  }

  function totalDuration(c: FocusCadence): string {
    const singleRound = c.workDurationMs + c.breakDurationMs;
    const total = singleRound * c.rounds - c.breakDurationMs;
    const minutes = Math.round(total / 60000);
    return `${minutes}m`;
  }
</script>

<button
  type="button"
  class="workflow-card"
  class:selected
  aria-pressed={selected}
  aria-label={`${name}, ${totalDuration(cadence)}, ${description}`}
  on:click={() => onSelect(workflow)}
>
  <div class="workflow-header">
    <span class="workflow-name">{name}</span>
    <span class="workflow-duration">{totalDuration(cadence)}</span>
  </div>

  <p class="workflow-description">{description}</p>

  <div class="workflow-meta">
    <span class="meta-pill">
      {cadence.rounds} rounds · {formatMs(cadence.workDurationMs)} work · {formatMs(cadence.breakDurationMs)} break
    </span>
    <span class="meta-pill music">{musicHint}</span>
  </div>
</button>

<style>
  .workflow-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: var(--jellyx-radius-md, 16px);
    background: var(--bg-surface, #111827);
    color: var(--text-primary, #e0e0e0);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }

  .workflow-card:hover {
    border-color: var(--color-accent, #6366f1);
    background: var(--bg-elevated, #1f2937);
  }

  .workflow-card:focus-visible {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 2px;
  }

  .workflow-card.selected {
    border-color: var(--color-accent, #6366f1);
    background: color-mix(in srgb, var(--color-accent, #6366f1) 12%, var(--bg-surface, #111827));
    box-shadow: 0 0 0 1px var(--color-accent, #6366f1);
  }

  .workflow-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .workflow-name {
    font-weight: 600;
    font-size: 1rem;
  }

  .workflow-duration {
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
    font-variant-numeric: tabular-nums;
  }

  .workflow-description {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--text-secondary, #9ca3af);
  }

  .workflow-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.25rem;
  }

  .meta-pill {
    padding: 0.25rem 0.5rem;
    border-radius: 999px;
    background: var(--bg-elevated, #1f2937);
    color: var(--text-secondary, #9ca3af);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .workflow-card.selected .meta-pill {
    background: color-mix(in srgb, var(--color-accent, #6366f1) 20%, var(--bg-elevated, #1f2937));
    color: var(--text-primary, #e0e0e0);
  }

  .meta-pill.music {
    font-style: italic;
  }
</style>
