/**
 * ActiveSession component tests.
 *
 * Verifies the component renders the timer, phase, goal, progress bars,
 * music strategy, and dispatches the expected events for each control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ActiveSession from './ActiveSession.svelte';
import TestWrapper from './ActiveSessionTestWrapper.svelte';
import type { FocusSession } from '@features/focus/types';

const tMap = new Map<string, string>([
  ['focus.active.title', 'Active focus session'],
  ['focus.active.phase_work', 'Focus'],
  ['focus.active.phase_break', 'break'],
  ['focus.active.instruction_work', 'Stay with your intention.'],
  ['focus.active.instruction_paused_work', 'Paused.'],
  ['focus.active.phase_progress', 'Round 1 of 4'],
  ['focus.active.total_progress', 'Total progress'],
  ['focus.active.music_label', 'Music'],
  ['focus.active.music_none', 'No music'],
  ['focus.active.music_continue', 'Continue current track'],
  ['focus.active.music_preset', 'Preset: {name}'],
  ['focus.active.music_query', 'Search: {query}'],
  ['focus.active.pause', 'pause'],
  ['focus.active.resume', 'resume'],
  ['focus.active.quick_note', 'Quick note'],
  ['focus.active.distraction', 'I got distracted'],
  ['focus.active.skip', 'Skip phase'],
  ['focus.active.end', 'End session'],
]);

vi.mock('@i18n', () => ({
  t: {
    subscribe(fn: (value: (key: string, params?: Record<string, string>) => string) => void) {
      fn((key: string, params?: Record<string, string>) => {
        const value = tMap.get(key) ?? key;
        if (!params) return value;
        return Object.entries(params).reduce((str, [k, v]) => str.replace(`{${k}}`, String(v)), value);
      });
      return () => {};
    },
  },
}));

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'focus-1',
    intention: 'Deep work',
    goal: 'Ship the fix',
    firstAction: 'Open the doc',
    workflow: 'pomodoro',
    cadence: { workDurationMs: 25 * 60 * 1000, breakDurationMs: 5 * 60 * 1000, rounds: 4 },
    round: 1,
    phase: 'work',
    state: 'runningWork',
    phaseStartedAt: Date.now(),
    phaseDeadlineAt: Date.now() + 25 * 60 * 1000,
    pausedRemainingMs: null,
    revision: 0,
    musicStrategy: { kind: 'none' },
    degradation: null,
    outcome: null,
    ...overrides,
  };
}

describe('ActiveSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders intention, goal, phase and initial timer', () => {
    render(ActiveSession, { props: { session: makeSession() } });

    expect(screen.getByText('Deep work')).toBeTruthy();
    expect(screen.getByText('Ship the fix')).toBeTruthy();
    expect(screen.getByText('Focus')).toBeTruthy();
    expect(screen.getByText('25:00')).toBeTruthy();
  });

  it('counts down the timer each second', async () => {
    render(ActiveSession, { props: { session: makeSession() } });

    expect(screen.getByText('25:00')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByText('24:59')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60000);
    expect(screen.getByText('23:59')).toBeTruthy();
  });

  it('pauses the display when the session state is paused', async () => {
    const session = makeSession({ state: 'pausedWork', pausedRemainingMs: 12 * 60 * 1000 });
    const { rerender } = render(ActiveSession, { props: { session } });

    expect(screen.getByText('12:00')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText('12:00')).toBeTruthy();

    rerender({ session: makeSession({ state: 'runningWork', phaseDeadlineAt: Date.now() + 12 * 60 * 1000 }) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByText('11:59')).toBeTruthy();
  });

  it('dispatches pause and resume from the primary control', async () => {
    const pauseHandler = vi.fn();
    const resumeHandler = vi.fn();
    render(TestWrapper, {
      props: { session: makeSession(), onPause: pauseHandler, onResume: resumeHandler },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    expect(pauseHandler).toHaveBeenCalledTimes(1);

    const paused = makeSession({ state: 'pausedWork', pausedRemainingMs: 10 * 60 * 1000 });
    // Re-render with paused session through the wrapper to exercise resume label.
    const { rerender } = render(TestWrapper, {
      props: { session: paused, onPause: pauseHandler, onResume: resumeHandler },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'resume' }));
    expect(resumeHandler).toHaveBeenCalledTimes(1);
  });

  it('dispatches skip and end', async () => {
    const skipHandler = vi.fn();
    const endHandler = vi.fn();
    render(TestWrapper, { props: { session: makeSession(), onSkip: skipHandler, onEnd: endHandler } });

    await fireEvent.click(screen.getByRole('button', { name: 'Skip phase' }));
    expect(skipHandler).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('dispatches quick note and distraction', async () => {
    const noteHandler = vi.fn();
    const distractionHandler = vi.fn();
    render(TestWrapper, {
      props: { session: makeSession(), onQuickNote: noteHandler, onDistraction: distractionHandler },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Quick note' }));
    expect(noteHandler).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'I got distracted' }));
    expect(distractionHandler).toHaveBeenCalledTimes(1);
  });

  it('shows a break badge and instruction during break phase', () => {
    render(ActiveSession, {
      props: {
        session: makeSession({
          phase: 'break',
          state: 'runningBreak',
          phaseDeadlineAt: Date.now() + 5 * 60 * 1000,
        }),
      },
    });

    expect(screen.getByText('break')).toBeTruthy();
    expect(screen.getByText('05:00')).toBeTruthy();
  });

  it('renders the music strategy label when music is set', () => {
    render(ActiveSession, {
      props: {
        session: makeSession({
          musicStrategy: { kind: 'query', value: 'lofi focus' },
        }),
      },
    });

    expect(screen.getByText('Search: lofi focus')).toBeTruthy();
  });

  it('hides music row when strategy is None', () => {
    const { container } = render(ActiveSession, { props: { session: makeSession() } });
    expect(container.querySelector('.music-row')).toBeNull();
  });
});
