import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { initI18n } from '@i18n';
import { focusStore } from '@features/focus/stores/focus';
import FocusPage from './Page.svelte';

afterEach(() => {
  cleanup();
  focusStore.clear();
});

describe('Focus recovery routing', () => {
  it('renders recovery before the normal active route', async () => {
    await initI18n();
    focusStore.set({
      session: {
        id: 'recover-1', intention: 'Recover me', goal: '', firstAction: '', workflow: 'pomodoro',
        cadence: { workDurationMs: 1500000, breakDurationMs: 300000, rounds: 4 }, round: 1,
        phase: 'work', state: 'runningWork', phaseStartedAt: Date.now(), phaseDeadlineAt: Date.now() + 1000,
        pausedRemainingMs: null, revision: 0, musicStrategy: { kind: 'none' }, degradation: null, outcome: null,
      },
      loading: false, error: null, recoveryRequired: true, pendingDirective: null, history: [],
    });

    const { container } = render(FocusPage);

    expect(container.querySelector('.recovery-prompt')).toBeTruthy();
    expect(container.querySelector('.active-session')).toBeNull();
  });
});
