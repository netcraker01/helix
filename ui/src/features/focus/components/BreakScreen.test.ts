import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { initI18n } from '@i18n';
import BreakScreen from './BreakScreen.svelte';

afterEach(cleanup);

describe('BreakScreen', () => {
  it('uses pausedRemainingMs for a paused break', async () => {
    await initI18n();
    const { getByText } = render(BreakScreen, { props: { session: {
      id: 'break-1', intention: '', goal: '', firstAction: '', workflow: 'pomodoro',
      cadence: { workDurationMs: 1500000, breakDurationMs: 300000, rounds: 4 }, round: 1,
      phase: 'break', state: 'pausedBreak', phaseStartedAt: null, phaseDeadlineAt: null,
      pausedRemainingMs: 120000, revision: 1, musicStrategy: { kind: 'none' }, degradation: null, outcome: null,
    } } });

    expect(getByText('02:00')).toBeTruthy();
  });
});
