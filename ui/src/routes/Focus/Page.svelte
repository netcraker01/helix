<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '@i18n';
  import { navigate } from '@app/router/navigation';
  import { focusStore } from '@features/focus/stores/focus';
  import FocusSetupWizard from '@features/focus/components/FocusSetupWizard.svelte';
  import ActiveSession from '@features/focus/components/ActiveSession.svelte';
  import BreakScreen from '@features/focus/components/BreakScreen.svelte';
  import SummaryScreen from '@features/focus/components/SummaryScreen.svelte';
  import QuickNoteModal from '@features/focus/components/QuickNoteModal.svelte';
  import DistractionModal from '@features/focus/components/DistractionModal.svelte';
  import FocusHistory from '@features/focus/components/FocusHistory.svelte';
  import type { FocusSession, FocusWorkflow, FocusMusicStrategy } from '@features/focus/types';

  let wizardOpen = false;
  let wizardRef: FocusSetupWizard;
  let noteModalOpen = false;
  let distractionModalOpen = false;
  let repeatInitialSetup: {
    intention?: string;
    workflow?: FocusWorkflow;
    goal?: string;
    firstAction?: string;
    musicStrategy?: FocusMusicStrategy;
  } | null = null;

  function handleStartRequest() {
    wizardOpen = true;
  }

  function handleWizardStart() {
    const setup = wizardRef.getSetup();
    focusStore.clear();
    void focusStore.start(
      setup.intention,
      setup.goal,
      setup.firstAction,
      setup.workflow,
      setup.cadence,
      setup.musicStrategy,
    );
    wizardOpen = false;
  }

  function handleWizardClose() {
    wizardOpen = false;
    repeatInitialSetup = null;
  }

  function handleHistoryRepeat(session: FocusSession) {
    repeatInitialSetup = {
      intention: session.intention,
      workflow: session.workflow,
      goal: session.goal,
      firstAction: session.firstAction,
      musicStrategy: session.musicStrategy,
    };
    wizardOpen = true;
  }

  function deriveView(session: FocusSession | null): 'idle' | 'active' | 'break' | 'summary' {
    if (!session) return 'idle';
    if (session.outcome != null || session.state === 'completed' || session.state === 'discarded') {
      return 'summary';
    }
    if (session.state === 'runningBreak' || session.state === 'pausedBreak') return 'break';
    return 'active';
  }

  $: session = $focusStore.session;
  $: view = deriveView(session);

  function handlePause() {
    void focusStore.pause();
  }

  function handleResume() {
    void focusStore.resume();
  }

  function handleSkip() {
    void focusStore.skip();
  }

  function handleEnd() {
    void focusStore.end();
  }

  function handleQuickNote(text: string) {
    void focusStore.captureNote(text);
    noteModalOpen = false;
  }

  function handleDistraction(text: string) {
    void focusStore.captureDistraction(text);
    distractionModalOpen = false;
  }

  function handleAddBreakTime() {
    // Visual extension only: backend does not yet support extending a break.
    focusStore.update((s) => {
      if (!s.session || s.session.phaseDeadlineAt == null) return s;
      return {
        ...s,
        session: {
          ...s.session,
          phaseDeadlineAt: s.session.phaseDeadlineAt + 5 * 60 * 1000,
          pausedRemainingMs:
            s.session.pausedRemainingMs != null
              ? s.session.pausedRemainingMs + 5 * 60 * 1000
              : s.session.pausedRemainingMs,
        },
      };
    });
  }

  function handleSummarySave() {
    focusStore.clear();
    navigate('/');
  }

  function handleSummaryRepeat() {
    wizardOpen = true;
  }

  function handleSummaryHome() {
    focusStore.clear();
    navigate('/');
  }

  function handleRecoveryContinue() {
    void focusStore.resumeRecovery();
  }

  function handleRecoveryDiscard() {
    void focusStore.discardRecovery();
  }

  function handleRecoveryComplete() {
    void focusStore.completeRecovery();
  }

  onMount(() => {
    void focusStore.loadHistory();
  });
</script>

<div class="page-focus">
  {#if $focusStore.loading}
    <div class="focus-state">{$t('common.loading')}</div>
  {:else if $focusStore.error}
    <div class="focus-state focus-error">
      <p>{$focusStore.error}</p>
    </div>
  {:else if $focusStore.recoveryRequired}
    <div class="recovery-prompt">
      <h2>{$t('focus.recovery_title')}</h2>
      <p>{$t('focus.recovery_desc')}</p>
      <div class="recovery-actions">
        <button class="recovery-btn primary" on:click={handleRecoveryContinue}>{$t('focus.recovery_continue')}</button>
        <button class="recovery-btn" on:click={handleRecoveryComplete}>{$t('focus.recovery_complete')}</button>
        <button class="recovery-btn danger" on:click={handleRecoveryDiscard}>{$t('focus.recovery_discard')}</button>
      </div>
    </div>
  {:else if view === 'idle'}
    <div class="focus-idle">
      <h1>{$t('focus.title')}</h1>
      <p>{$t('focus.tagline')}</p>
      <button class="start-btn" on:click={handleStartRequest}>{$t('focus.start_session')}</button>
      <FocusHistory sessions={$focusStore.history} onRepeat={handleHistoryRepeat} onDelete={(id) => void focusStore.deleteHistory(id)} />
    </div>
  {:else if view === 'active'}
    <ActiveSession
      session={session as FocusSession}
      loading={$focusStore.loading}
      onPause={handlePause}
      onResume={handleResume}
      onSkip={handleSkip}
      onEnd={handleEnd}
      onQuickNote={() => (noteModalOpen = true)}
      onDistraction={() => (distractionModalOpen = true)}
    />
   {:else if view === 'break'}
    <BreakScreen
      session={session as FocusSession}
      loading={$focusStore.loading}
      onSkip={handleSkip}
      onAddTime={handleAddBreakTime}
      onEnd={handleEnd}
    />
  {:else}
    <SummaryScreen
      session={session as FocusSession}
      onSave={handleSummarySave}
      onRepeat={handleSummaryRepeat}
      onHome={handleSummaryHome}
    />
  {/if}
</div>

<FocusSetupWizard bind:this={wizardRef} bind:open={wizardOpen} initialSetup={repeatInitialSetup} onClose={handleWizardClose} onStart={handleWizardStart} />

<QuickNoteModal
  bind:open={noteModalOpen}
  onClose={() => (noteModalOpen = false)}
  onSave={(value) => handleQuickNote(value)}
/>

<DistractionModal
  bind:open={distractionModalOpen}
  onClose={() => (distractionModalOpen = false)}
  onSave={(value) => handleDistraction(value)}
/>

<style>
  .page-focus {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 2rem;
  }

  .focus-idle,
  .focus-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
  }

  .focus-idle h1 {
    margin: 0;
    font-size: 2rem;
    color: var(--text-primary, #e0e0e0);
  }

  .focus-idle p {
    margin: 0;
    color: var(--text-secondary, #9ca3af);
  }

  .focus-error p {
    color: var(--color-error, #ef4444);
  }

  .start-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.75rem;
    border: 1px solid var(--color-accent, #6366f1);
    border-radius: 24px;
    background: transparent;
    color: var(--color-accent, #6366f1);
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s, color 0.2s, box-shadow 0.2s;
  }

  .start-btn:hover {
    background: var(--color-accent, #6366f1);
    color: #ffffff;
    box-shadow: 0 0 12px rgba(138, 92, 255, 0.35);
  }

  .start-btn:focus-visible {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 2px;
  }

  .recovery-prompt {
    width: 100%;
    max-width: 480px;
    padding: 1.25rem;
    border: 1px solid var(--color-accent, #6366f1);
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.08);
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .recovery-prompt h2 {
    font-size: 1.05rem;
    margin: 0 0 0.5rem;
    color: var(--text-primary, #e0e0e0);
  }

  .recovery-prompt p {
    font-size: 0.88rem;
    color: var(--text-secondary, #9ca3af);
    margin: 0 0 1rem;
  }

  .recovery-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .recovery-btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--border-color, #374151);
    border-radius: 999px;
    background: transparent;
    color: var(--text-primary, #e0e0e0);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .recovery-btn.primary {
    background: var(--color-accent, #6366f1);
    color: #fff;
    border-color: var(--color-accent, #6366f1);
  }

  .recovery-btn.danger {
    color: var(--color-error, #ef4444);
    border-color: var(--color-error, #ef4444);
  }

  .recovery-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .recovery-btn.primary:hover {
    background: var(--color-accent, #6366f1);
    opacity: 0.9;
  }
</style>
