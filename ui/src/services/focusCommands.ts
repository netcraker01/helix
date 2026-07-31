/**
 * Typed Tauri command wrappers for Focus IPC.
 *
 * Thin wrappers around invokeCommand. All command names match the Rust
 * #[tauri::command] function names. Parameters use camelCase.
 */

import { invokeCommand } from './tauri';
import type {
  FocusCadence,
  FocusCommandError,
  FocusEvent,
  FocusMutationResult,
  FocusMusicStrategy,
  FocusPlaybackFailure,
  FocusPreferences,
  FocusRecoveryAction,
  FocusSession,
  FocusWorkflow,
} from '@features/focus/types';

/** Get the active Focus session, reconciling an elapsed deadline once. */
export function getActiveFocus(): Promise<FocusSession | null> {
  return invokeCommand<FocusSession | null>('get_active_focus');
}

/** Recover a nonterminal session; returns null if idle. */
export function recoverFocus(): Promise<FocusSession | null> {
  return invokeCommand<FocusSession | null>('recover_focus');
}

/** Start a new Focus session from the wizard values. */
export function startFocusSession(
  requestId: string,
  intention: string,
  goal: string,
  firstAction: string,
  workflow: FocusWorkflow,
  cadence: FocusCadence,
  musicStrategy: FocusMusicStrategy,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('start_focus_session', {
    requestId,
    expectedRevision: 0,
    intention,
    goal,
    firstAction,
    workflow,
    cadence,
    musicStrategy,
  });
}

/** Pause the current work/break phase. */
export function pauseFocus(
  requestId: string,
  id: string,
  expectedRevision: number,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('pause_focus', {
    requestId,
    id,
    expectedRevision,
  });
}

/** Resume the current paused phase. */
export function resumeFocus(
  requestId: string,
  id: string,
  expectedRevision: number,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('resume_focus', {
    requestId,
    id,
    expectedRevision,
  });
}

/** Skip to the next phase (work→break, break→work, final→completed). */
export function skipFocus(
  requestId: string,
  id: string,
  expectedRevision: number,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('skip_focus', {
    requestId,
    id,
    expectedRevision,
  });
}

/** End the session, completing it. */
export function endFocus(
  requestId: string,
  id: string,
  expectedRevision: number,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('end_focus', {
    requestId,
    id,
    expectedRevision,
  });
}

/** Discard the active session. */
export function discardFocus(
  requestId: string,
  id: string,
  expectedRevision: number,
): Promise<FocusMutationResult> {
  return invokeCommand<FocusMutationResult>('discard_focus', {
    requestId,
    id,
    expectedRevision,
  });
}

/** Record a playback failure without rolling back Focus state. */
export function degradeFocusPlayback(
  requestId: string,
  id: string,
  expectedRevision: number,
  failure: FocusPlaybackFailure,
): Promise<FocusSession> {
  return invokeCommand<FocusSession>('degrade_focus_playback', {
    requestId,
    id,
    expectedRevision,
    failure,
  });
}

/** Record a note or distraction for the active Focus session. */
export function captureFocusItem(
  requestId: string,
  id: string,
  expectedRevision: number,
  kind: 'note' | 'distraction',
  body: string,
): Promise<FocusSession> {
  return invokeCommand<FocusSession>('capture_focus_item', {
    requestId,
    id,
    expectedRevision,
    kind,
    body,
  });
}

/** List recent completed/discarded Focus sessions for history. */
export function listFocusSessions(limit: number = 20): Promise<FocusSession[]> {
  return invokeCommand<FocusSession[]>('list_focus_sessions', { limit });
}

/** Delete a terminal (completed/discarded) Focus session by ID. */
export function deleteFocusSession(id: string): Promise<void> {
  return invokeCommand<void>('delete_focus_session', { id });
}

/** Acknowledge the outcome of a playback directive. */
export function ackFocusPlayback(
  requestId: string,
  id: string,
  expectedRevision: number,
  directiveId: string,
  failure?: FocusPlaybackFailure,
): Promise<FocusSession> {
  return invokeCommand<FocusSession>('ack_focus_playback', {
    requestId,
    id,
    expectedRevision,
    directiveId,
    failure: failure ?? null,
  });
}

/** Get persisted preferences. */
export function getFocusPreferences(): Promise<FocusPreferences> {
  return invokeCommand<FocusPreferences>('get_focus_preferences');
}

/** Save persisted preferences. */
export function setFocusPreferences(preferences: FocusPreferences): Promise<FocusPreferences> {
  return invokeCommand<FocusPreferences>('set_focus_preferences', { preferences });
}

/** Apply a recovery action to an interrupted session. */
export function recoverFocusWithAction(
  requestId: string,
  id: string,
  expectedRevision: number,
  action: FocusRecoveryAction,
): Promise<FocusMutationResult> {
  switch (action) {
    case 'resume':
      return resumeFocus(requestId, id, expectedRevision);
    case 'complete':
      return endFocus(requestId, id, expectedRevision);
    case 'discard':
      return discardFocus(requestId, id, expectedRevision);
  }
}

/** Convenience: no-op recovery mapping for the UI idle state. */
export function focusRecoveryOptions(): FocusRecoveryAction[] {
  return ['resume', 'complete', 'discard'];
}
