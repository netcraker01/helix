/**
 * Focus store tests.
 *
 * Verifies the store wraps IPC commands, updates reactive state, handles
 * errors, and applies backend events without duplicating canonical state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
  getActiveFocus: vi.fn(),
  recoverFocus: vi.fn(),
  startFocusSession: vi.fn(),
  pauseFocus: vi.fn(),
  resumeFocus: vi.fn(),
  skipFocus: vi.fn(),
  endFocus: vi.fn(),
  discardFocus: vi.fn(),
  captureFocusItem: vi.fn(),
  ackFocusPlayback: vi.fn(),
  degradeFocusPlayback: vi.fn(),
  onFocusEvent: vi.fn(),
}));

vi.mock('@services/focusCommands', () => ({
  getActiveFocus: mocks.getActiveFocus,
  recoverFocus: mocks.recoverFocus,
  startFocusSession: mocks.startFocusSession,
  pauseFocus: mocks.pauseFocus,
  resumeFocus: mocks.resumeFocus,
  skipFocus: mocks.skipFocus,
  endFocus: mocks.endFocus,
  discardFocus: mocks.discardFocus,
  captureFocusItem: mocks.captureFocusItem,
  ackFocusPlayback: mocks.ackFocusPlayback,
  degradeFocusPlayback: mocks.degradeFocusPlayback,
}));

vi.mock('@features/focus/events', () => ({
  onFocusEvent: mocks.onFocusEvent,
}));

vi.mock('@shared/stores/notifications', () => ({
  notifications: {
    push: vi.fn(),
  },
}));

vi.mock('@i18n', () => ({
  t: { subscribe: (fn: (v: (k: string) => string) => void) => { fn((k) => k); return () => {}; } },
}));

import { focusStore, startFocusListener, stopFocusListener } from './focus';
import type { FocusSession } from '@features/focus/types';

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'focus-1',
    intention: 'Deep work',
    goal: '',
    firstAction: '',
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

describe('focusStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusStore.clear();
    mocks.getActiveFocus.mockResolvedValue(null);
    mocks.recoverFocus.mockResolvedValue(null);
    mocks.onFocusEvent.mockResolvedValue(() => {});
  });

  afterEach(() => {
    stopFocusListener();
  });

  it('loads and shows idle when no session exists', async () => {
    mocks.recoverFocus.mockResolvedValueOnce(null);
    mocks.getActiveFocus.mockResolvedValueOnce(null);

    await focusStore.load();

    expect(get(focusStore).session).toBeNull();
    expect(get(focusStore).loading).toBe(false);
    expect(get(focusStore).recoveryRequired).toBe(false);
  });

  it('shows recovery prompt when a nonterminal session exists', async () => {
    const session = makeSession();
    mocks.recoverFocus.mockResolvedValueOnce(session);

    await focusStore.load();

    expect(get(focusStore).session).toEqual(session);
    expect(get(focusStore).recoveryRequired).toBe(true);
  });

  it('starts a session and updates state', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });

    await focusStore.start('Deep work', 'Ship the fix', 'Open the doc', 'pomodoro', session.cadence, { kind: 'none' });

    expect(get(focusStore).session).toEqual(session);
    expect(get(focusStore).error).toBeNull();
    expect(mocks.startFocusSession).toHaveBeenCalledWith(
      expect.stringMatching(/^focus-ui-/),
      'Deep work',
      'Ship the fix',
      'Open the doc',
      'pomodoro',
      session.cadence,
      { kind: 'none' },
    );
  });

  it('tracks the latest playback directive from a start response', async () => {
    const session = makeSession();
    const directive = { operationId: 'op-1', action: 'play' as const };
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session, playbackDirective: directive });

    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'continueCurrent' });

    expect(get(focusStore).pendingDirective).toEqual(directive);
  });

  it('preserves directives returned by pause and across its session event', async () => {
    const started = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'start', snapshot: started });
    await focusStore.start('Deep work', '', '', 'pomodoro', started.cadence, { kind: 'continueCurrent' });
    const paused = makeSession({ state: 'pausedWork', revision: 1 });
    const directive = { operationId: 'pause-op', action: 'pause' as const };
    mocks.pauseFocus.mockResolvedValueOnce({ operationId: 'pause-op', snapshot: paused, playbackDirective: directive });

    await focusStore.pause();
    focusStore.applyEvent({ sessionId: paused.id, operationId: 'pause-op', revision: 1, kind: 'sessionMutation', value: paused });

    expect(get(focusStore).pendingDirective).toEqual(directive);
  });

  it('pauses using the current session revision', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    const paused = makeSession({ state: 'pausedWork', revision: 1 });
    mocks.pauseFocus.mockResolvedValueOnce({ operationId: 'op-2', snapshot: paused });
    await focusStore.pause();

    expect(get(focusStore).session?.state).toBe('pausedWork');
    expect(mocks.pauseFocus).toHaveBeenCalledWith(expect.stringMatching(/^focus-ui-/), 'focus-1', 0);
  });

  it('sets error when pause is called without a session', async () => {
    await focusStore.pause();

    expect(get(focusStore).error).toContain('No active Focus session');
  });

  it('applies a PhaseChange event to the current snapshot and copies revision for OCC', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    focusStore.applyEvent({
      sessionId: 'focus-1',
      operationId: 'op-event',
      revision: 1,
      kind: 'phaseChange',
      value: { phase: 'break', state: 'runningBreak' },
    });

    expect(get(focusStore).session?.phase).toBe('break');
    expect(get(focusStore).session?.state).toBe('runningBreak');
    expect(get(focusStore).session?.revision).toBe(1);

    const paused = makeSession({ phase: 'break', state: 'runningBreak', revision: 1 });
    mocks.pauseFocus.mockResolvedValueOnce({ operationId: 'op-2', snapshot: paused });
    await focusStore.pause();

    expect(mocks.pauseFocus).toHaveBeenCalledWith(expect.stringMatching(/^focus-ui-/), 'focus-1', 1);
  });

  it.each(['completed', 'discarded'] as const)(
    'does not resurrect a %s SessionMutation when its PhaseChange arrives afterward',
    (terminalState) => {
      const terminal = makeSession({
        state: terminalState,
        outcome: terminalState,
        phaseDeadlineAt: null,
        revision: 2,
      });
      focusStore.applyEvent({
        sessionId: terminal.id,
        operationId: 'terminal-op',
        revision: 2,
        kind: 'sessionMutation',
        value: terminal,
      });

      focusStore.applyEvent({
        sessionId: terminal.id,
        operationId: 'terminal-op',
        revision: 2,
        kind: 'phaseChange',
        value: { phase: 'break', state: 'runningBreak' },
      });

      expect(get(focusStore).session).toEqual(terminal);
    },
  );

  it('applies a PlaybackDirective event', async () => {
    focusStore.applyEvent({
      sessionId: 'focus-1',
      operationId: 'op-directive',
      revision: 1,
      kind: 'playbackDirective',
      value: { operationId: 'op-directive', action: 'pause' },
    });

    expect(get(focusStore).pendingDirective).toEqual({ operationId: 'op-directive', action: 'pause' });
  });

  it('applies a Degraded event to the current snapshot and copies revision for OCC', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    focusStore.applyEvent({
      sessionId: 'focus-1',
      operationId: 'op-degraded',
      revision: 3,
      kind: 'degraded',
      value: { reason: 'offline', occurredAt: Date.now() },
    });

    expect(get(focusStore).session?.degradation?.reason).toBe('offline');
    expect(get(focusStore).session?.revision).toBe(3);
  });

  it('ignores phase and degraded events for a mismatched sessionId', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    focusStore.applyEvent({
      sessionId: 'focus-2',
      operationId: 'op-event',
      revision: 7,
      kind: 'phaseChange',
      value: { phase: 'break', state: 'runningBreak' },
    });

    expect(get(focusStore).session?.phase).toBe('work');
    expect(get(focusStore).session?.revision).toBe(0);

    focusStore.applyEvent({
      sessionId: 'focus-2',
      operationId: 'op-degraded',
      revision: 9,
      kind: 'degraded',
      value: { reason: 'offline', occurredAt: Date.now() },
    });

    expect(get(focusStore).session?.degradation).toBeNull();
    expect(get(focusStore).session?.revision).toBe(0);
  });

  it('applies a real Rust flat payload after JSON.parse to prevent regression', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    const rustPayload = JSON.parse(
      '{"sessionId":"focus-1","operationId":"op-phase","revision":2,"kind":"phaseChange","value":{"phase":"break","state":"runningBreak"}}',
    );

    focusStore.applyEvent(rustPayload);

    expect(get(focusStore).session?.phase).toBe('break');
    expect(get(focusStore).session?.state).toBe('runningBreak');
    expect(get(focusStore).session?.revision).toBe(2);
  });

  it('acknowledges a playback directive', async () => {
    const session = makeSession({ revision: 1 });
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    const acked = makeSession({ revision: 2 });
    mocks.ackFocusPlayback.mockResolvedValueOnce(acked);
    await focusStore.acknowledgePlayback('op-directive');

    expect(mocks.ackFocusPlayback).toHaveBeenCalledWith(expect.stringMatching(/^focus-ui-/), 'focus-1', 1, 'op-directive', undefined);
    expect(get(focusStore).pendingDirective).toBeNull();
  });

  it('captures a note using the current session revision', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    const captured = makeSession({ captures: [{ id: 1, sessionId: 'focus-1', kind: 'note', body: 'Milestone', createdAt: Date.now() }], revision: 1 });
    mocks.captureFocusItem.mockResolvedValueOnce(captured);
    await focusStore.captureNote('Milestone');

    expect(mocks.captureFocusItem).toHaveBeenCalledWith(expect.stringMatching(/^focus-ui-/), 'focus-1', 0, 'note', 'Milestone');
    expect(get(focusStore).session?.captures).toHaveLength(1);
    expect(get(focusStore).session?.revision).toBe(1);
  });

  it('captures a distraction using the current session revision', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    const captured = makeSession({ captures: [{ id: 1, sessionId: 'focus-1', kind: 'distraction', body: 'Noise', createdAt: Date.now() }], revision: 1 });
    mocks.captureFocusItem.mockResolvedValueOnce(captured);
    await focusStore.captureDistraction('Noise');

    expect(mocks.captureFocusItem).toHaveBeenCalledWith(expect.stringMatching(/^focus-ui-/), 'focus-1', 0, 'distraction', 'Noise');
    expect(get(focusStore).session?.captures?.[0].kind).toBe('distraction');
  });

  it('clears state', async () => {
    const session = makeSession();
    mocks.startFocusSession.mockResolvedValueOnce({ operationId: 'op-1', snapshot: session });
    await focusStore.start('Deep work', '', '', 'pomodoro', session.cadence, { kind: 'none' });

    focusStore.clear();

    expect(get(focusStore).session).toBeNull();
    expect(get(focusStore).error).toBeNull();
    expect(get(focusStore).recoveryRequired).toBe(false);
  });

  it('starts and stops the event listener', async () => {
    const unlisten = await startFocusListener();
    expect(mocks.onFocusEvent).toHaveBeenCalledWith(expect.any(Function));
    expect(typeof unlisten).toBe('function');

    stopFocusListener();
    // Calling again is safe and idempotent.
    stopFocusListener();
  });
});
