<script lang="ts">
  import { t } from '@i18n';
  import WorkflowCard from './WorkflowCard.svelte';
  import type {
    FocusCadence,
    FocusMusicStrategy,
    FocusWorkflow,
  } from '@features/focus/types';

  export let open = false;
  export let onClose: () => void = () => {};
  export let onStart: () => void = () => {};
  export let initialSetup: {
    intention?: string;
    workflow?: FocusWorkflow;
    goal?: string;
    firstAction?: string;
    musicStrategy?: FocusMusicStrategy;
  } | null = null;

  type Step = 'intention' | 'workflow' | 'goal' | 'music' | 'options' | 'review';
  let step: Step = 'intention';
  let intention = '';
  let selectedWorkflow: FocusWorkflow = 'pomodoro';
  let goal = '';
  let firstAction = '';
  let musicStrategy: FocusMusicStrategy = { kind: 'none' };
  let musicQuery = '';
  let selectedPresetQuery = '';

  const presets: { labelKey: string; query: string }[] = [
    { labelKey: 'focus.wizard.preset_lofi', query: 'lofi focus' },
    { labelKey: 'focus.wizard.preset_ambient', query: 'ambient music' },
    { labelKey: 'focus.wizard.preset_classical', query: 'classical music' },
    { labelKey: 'focus.wizard.preset_jazz', query: 'jazz focus' },
    { labelKey: 'focus.wizard.preset_nature', query: 'nature sounds' },
  ];
  let optionSkipBreaks = false;
  let optionStrictMode = false;

  const builtinWorkflows: {
    workflow: FocusWorkflow;
    nameKey: string;
    descriptionKey: string;
    cadence: FocusCadence;
    musicHintKey: string;
  }[] = [
    {
      workflow: 'pomodoro',
      nameKey: 'focus.wizard.workflow_pomodoro_name',
      descriptionKey: 'focus.wizard.workflow_pomodoro_desc',
      cadence: { workDurationMs: 25 * 60 * 1000, breakDurationMs: 5 * 60 * 1000, rounds: 4 },
      musicHintKey: 'focus.wizard.workflow_pomodoro_music',
    },
    {
      workflow: 'deepWork',
      nameKey: 'focus.wizard.workflow_deepwork_name',
      descriptionKey: 'focus.wizard.workflow_deepwork_desc',
      cadence: { workDurationMs: 90 * 60 * 1000, breakDurationMs: 15 * 60 * 1000, rounds: 2 },
      musicHintKey: 'focus.wizard.workflow_deepwork_music',
    },
    {
      workflow: 'quickFocus',
      nameKey: 'focus.wizard.workflow_quick_name',
      descriptionKey: 'focus.wizard.workflow_quick_desc',
      cadence: { workDurationMs: 15 * 60 * 1000, breakDurationMs: 0, rounds: 1 },
      musicHintKey: 'focus.wizard.workflow_quick_music',
    },
  ];

  function selectedCadence(): FocusCadence {
    return (
      builtinWorkflows.find((w) => w.workflow === selectedWorkflow)?.cadence ?? {
        workDurationMs: 25 * 60 * 1000,
        breakDurationMs: 5 * 60 * 1000,
        rounds: 4,
      }
    );
  }

  function resolveMusicStrategy(): FocusMusicStrategy {
    switch (musicStrategy.kind) {
      case 'continueCurrent':
        return { kind: 'continueCurrent' };
      case 'query':
        return { kind: 'query', value: musicQuery.trim() || 'lofi focus' };
      default:
        return { kind: 'none' };
    }
  }

  function stepTitle(s: Step): string {
    const titles: Record<Step, string> = {
      intention: 'focus.wizard.step_intention',
      workflow: 'focus.wizard.step_workflow',
      goal: 'focus.wizard.step_goal',
      music: 'focus.wizard.step_music',
      options: 'focus.wizard.step_options',
      review: 'focus.wizard.step_review',
    };
    return titles[s];
  }

  function nextStep(): void {
    if (step === 'intention') step = 'workflow';
    else if (step === 'workflow') step = 'goal';
    else if (step === 'goal') step = 'music';
    else if (step === 'music') step = 'options';
    else if (step === 'options') step = 'review';
  }

  function previousStep(): void {
    if (step === 'workflow') step = 'intention';
    else if (step === 'goal') step = 'workflow';
    else if (step === 'music') step = 'goal';
    else if (step === 'options') step = 'music';
    else if (step === 'review') step = 'options';
  }

  function handleStart(): void {
    onStart();
  }

  function reset(): void {
    step = 'intention';
    intention = '';
    selectedWorkflow = 'pomodoro';
    goal = '';
    firstAction = '';
    musicStrategy = { kind: 'none' };
    musicQuery = '';
    selectedPresetQuery = '';
    optionSkipBreaks = false;
    optionStrictMode = false;
  }

  function close(): void {
    onClose();
  }

  $: if (!open) reset();

  $: if (open && initialSetup) {
    if (initialSetup.intention != null) intention = initialSetup.intention;
    if (initialSetup.workflow != null) selectedWorkflow = initialSetup.workflow;
    if (initialSetup.goal != null) goal = initialSetup.goal;
    if (initialSetup.firstAction != null) firstAction = initialSetup.firstAction;
    if (initialSetup.musicStrategy != null) {
      musicStrategy = initialSetup.musicStrategy;
      if (musicStrategy.kind === 'query') {
        const q = musicStrategy as { kind: 'query'; value: string };
        musicQuery = q.value;
        selectedPresetQuery = presets.find((p) => p.query === q.value)?.query ?? '';
      }
    }
  }

  export function getSetup(): {
    intention: string;
    workflow: FocusWorkflow;
    cadence: FocusCadence;
    goal: string;
    firstAction: string;
    musicStrategy: FocusMusicStrategy;
    skipBreaks: boolean;
    strictMode: boolean;
  } {
    return {
      intention: intention.trim(),
      workflow: selectedWorkflow,
      cadence: selectedCadence(),
      goal: goal.trim(),
      firstAction: firstAction.trim(),
      musicStrategy: resolveMusicStrategy(),
      skipBreaks: optionSkipBreaks,
      strictMode: optionStrictMode,
    };
  }
</script>

{#if open}
  <div class="wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="focus-wizard-title">
    <div class="wizard-panel">
      <div class="wizard-header">
        <h2 id="focus-wizard-title">{$t('focus.wizard.title')}</h2>
        <button type="button" class="close-btn" aria-label={$t('common.close')} on:click={close}>
          ×
        </button>
      </div>

      <div class="wizard-step" aria-live="polite">
        <p class="step-label">{$t(stepTitle(step))}</p>

        {#if step === 'intention'}
          <label class="field-label" for="intention-input">{$t('focus.wizard.intention_label')}</label>
          <input
            id="intention-input"
            type="text"
            class="wizard-input"
            bind:value={intention}
            placeholder={$t('focus.wizard.intention_placeholder')}
            maxlength="120"
          />
        {:else if step === 'workflow'}
          <div class="workflow-list" role="radiogroup" aria-label={$t('focus.wizard.workflow_label')}>
            {#each builtinWorkflows as workflow}
              <WorkflowCard
                workflow={workflow.workflow}
                name={$t(workflow.nameKey)}
                description={$t(workflow.descriptionKey)}
                cadence={workflow.cadence}
                musicHint={$t(workflow.musicHintKey)}
                selected={selectedWorkflow === workflow.workflow}
                onSelect={(w) => (selectedWorkflow = w)}
              />
            {/each}
          </div>
        {:else if step === 'goal'}
          <label class="field-label" for="goal-input">{$t('focus.wizard.goal_label')}</label>
          <input
            id="goal-input"
            type="text"
            class="wizard-input"
            bind:value={goal}
            placeholder={$t('focus.wizard.goal_placeholder')}
            maxlength="200"
          />
          <label class="field-label" for="action-input">{$t('focus.wizard.action_label')}</label>
          <input
            id="action-input"
            type="text"
            class="wizard-input"
            bind:value={firstAction}
            placeholder={$t('focus.wizard.action_placeholder')}
            maxlength="200"
          />
        {:else if step === 'music'}
          <div class="music-options" role="radiogroup" aria-label={$t('focus.wizard.music_label')}>
            <label class="music-option" class:selected={musicStrategy.kind === 'none'}>
              <input type="radio" bind:group={musicStrategy.kind} value="none" />
              <span>{$t('focus.wizard.music_none')}</span>
            </label>
            <label class="music-option" class:selected={musicStrategy.kind === 'continueCurrent'}>
              <input type="radio" bind:group={musicStrategy.kind} value="continueCurrent" />
              <span>{$t('focus.wizard.music_continue')}</span>
            </label>
            <label class="music-option" class:selected={musicStrategy.kind === 'query'}>
              <input type="radio" bind:group={musicStrategy.kind} value="query" />
              <span>{$t('focus.wizard.music_search')}</span>
              {#if musicStrategy.kind === 'query'}
                <div class="preset-chips">
                  {#each presets as preset}
                    <button
                      type="button"
                      class="preset-chip"
                      class:active={selectedPresetQuery === preset.query}
                      on:click={() => {
                        musicQuery = preset.query;
                        selectedPresetQuery = preset.query;
                      }}
                    >
                      {$t(preset.labelKey)}
                    </button>
                  {/each}
                </div>
                <input
                  type="text"
                  class="wizard-input nested"
                  bind:value={musicQuery}
                  on:input={() => {
                    selectedPresetQuery = presets.find((p) => p.query === musicQuery)?.query ?? '';
                  }}
                  placeholder={$t('focus.wizard.music_query_placeholder')}
                  maxlength="120"
                />
              {/if}
            </label>
          </div>
        {:else if step === 'options'}
          <label class="option-row disabled" title={$t('focus.wizard.coming_soon')}>
            <input type="checkbox" bind:checked={optionSkipBreaks} disabled />
            <span>{$t('focus.wizard.option_skip_breaks')} — {$t('focus.wizard.coming_soon')}</span>
          </label>
          <label class="option-row disabled" title={$t('focus.wizard.coming_soon')}>
            <input type="checkbox" bind:checked={optionStrictMode} disabled />
            <span>{$t('focus.wizard.option_strict_mode')} — {$t('focus.wizard.coming_soon')}</span>
          </label>
          <p class="option-note">{$t('focus.wizard.options_note')}</p>
        {:else if step === 'review'}
          <div class="review-summary">
            <div class="review-row">
              <span>{$t('focus.wizard.review_intention')}</span>
              <strong>{intention.trim() || $t('focus.wizard.review_unset')}</strong>
            </div>
            <div class="review-row">
              <span>{$t('focus.wizard.review_workflow')}</span>
              <strong>{selectedWorkflow}</strong>
            </div>
            <div class="review-row">
              <span>{$t('focus.wizard.review_goal')}</span>
              <strong>{goal.trim() || $t('focus.wizard.review_unset')}</strong>
            </div>
            <div class="review-row">
              <span>{$t('focus.wizard.review_first_action')}</span>
              <strong>{firstAction.trim() || $t('focus.wizard.review_unset')}</strong>
            </div>
            <div class="review-row">
              <span>{$t('focus.wizard.review_music')}</span>
              <strong>{resolveMusicStrategy().kind}</strong>
            </div>
          </div>
        {/if}
      </div>

      <div class="wizard-actions">
        <button
          type="button"
          class="action-btn secondary"
          on:click={step === 'intention' ? close : previousStep}
        >
          {step === 'intention' ? $t('common.cancel') : $t('common.back')}
        </button>

        {#if step === 'review'}
          <button type="button" class="action-btn primary" on:click={handleStart}>
            {$t('focus.wizard.start')}
          </button>
        {:else}
          <button type="button" class="action-btn primary" on:click={nextStep}>
            {$t('common.save')}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .wizard-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
  }

  .wizard-panel {
    width: 100%;
    max-width: 520px;
    max-height: calc(100vh - 2rem);
    display: flex;
    flex-direction: column;
    border-radius: var(--jellyx-radius-lg, 24px);
    background: var(--bg-surface, #111827);
    border: 1px solid var(--border-color, #1f2937);
    box-shadow: var(--jellyx-shadow-soft, 0 18px 36px rgb(11 15 43 / 12%));
    overflow: hidden;
  }

  .wizard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--border-color, #1f2937);
  }

  .wizard-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary, #9ca3af);
    font-size: 1.25rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: var(--bg-elevated, #1f2937);
    color: var(--text-primary, #e0e0e0);
  }

  .wizard-step {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step-label {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #9ca3af);
  }

  .field-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary, #e0e0e0);
  }

  .wizard-input {
    width: 100%;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: var(--jellyx-radius-sm, 8px);
    background: var(--bg-elevated, #1f2937);
    color: var(--text-primary, #e0e0e0);
    font-size: 0.95rem;
    transition: border-color 0.15s;
  }

  .wizard-input::placeholder {
    color: var(--text-secondary, #9ca3af);
    opacity: 0.7;
  }

  .wizard-input:focus {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
    border-color: var(--color-accent, #6366f1);
  }

  .wizard-input.nested {
    margin-top: 0.5rem;
  }

  .workflow-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .music-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .preset-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .preset-chip {
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--border-color, #374151);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary, #9ca3af);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .preset-chip:hover {
    border-color: var(--color-accent, #6366f1);
    color: var(--text-primary, #e0e0e0);
  }

  .preset-chip.active {
    border-color: var(--color-accent, #6366f1);
    background: color-mix(in srgb, var(--color-accent, #6366f1) 20%, transparent);
    color: var(--text-primary, #e0e0e0);
  }

  .music-option,
  .option-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: var(--jellyx-radius-sm, 8px);
    background: var(--bg-elevated, #1f2937);
    color: var(--text-primary, #e0e0e0);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .music-option:hover,
  .option-row:hover {
    border-color: var(--color-accent, #6366f1);
  }

  .music-option.selected {
    border-color: var(--color-accent, #6366f1);
    background: color-mix(in srgb, var(--color-accent, #6366f1) 12%, var(--bg-elevated, #1f2937));
  }

  .music-option:has(input[type='radio']:focus-visible) {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
  }

  .music-option > span,
  .option-row > span {
    flex: 1;
    font-size: 0.95rem;
  }

  .option-note {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    color: var(--text-secondary, #9ca3af);
  }

  .review-summary {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .review-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-color, #1f2937);
    font-size: 0.95rem;
  }

  .review-row span {
    color: var(--text-secondary, #9ca3af);
  }

  .review-row strong {
    color: var(--text-primary, #e0e0e0);
    font-weight: 500;
    text-align: right;
  }

  .wizard-actions {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem 1.25rem;
    border-top: 1px solid var(--border-color, #1f2937);
  }

  .action-btn {
    padding: 0.6rem 1.25rem;
    border-radius: var(--jellyx-radius-md, 16px);
    border: 1px solid transparent;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .action-btn.primary {
    background: var(--color-accent, #6366f1);
    color: #ffffff;
  }

  .action-btn.primary:hover {
    background: color-mix(in srgb, var(--color-accent, #6366f1) 85%, #ffffff);
  }

  .action-btn.secondary {
    background: transparent;
    border-color: var(--border-color, #1f2937);
    color: var(--text-secondary, #9ca3af);
  }

  .action-btn.secondary:hover {
    border-color: var(--color-accent, #6366f1);
    color: var(--text-primary, #e0e0e0);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 2px;
  }
</style>
