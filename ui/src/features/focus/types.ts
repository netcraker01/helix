/**
 * Focus domain types — mirror of Rust `focus::models`.
 *
 * Serde on the Rust side uses `rename_all = "camelCase"` and
 * `tag = "kind", content = "value"` for tagged enums, so these
 * TypeScript interfaces match the emitted JSON exactly.
 */

export type FocusWorkflow = 'pomodoro' | 'deepWork' | 'quickFocus' | 'custom';

export interface FocusCadence {
  workDurationMs: number;
  breakDurationMs: number;
  rounds: number;
}

export type FocusPhase = 'work' | 'break';

export type FocusSessionState =
  | 'draft'
  | 'runningWork'
  | 'pausedWork'
  | 'awaitingTransition'
  | 'runningBreak'
  | 'pausedBreak'
  | 'completed'
  | 'discarded';

export type FocusMusicStrategy =
  | { kind: 'none' }
  | { kind: 'continueCurrent' }
  | { kind: 'preset'; value: string }
  | { kind: 'query'; value: string };

export type FocusPlaybackAction = 'play' | 'pause' | 'resume' | 'stop';

export type FocusPlaybackIntent =
  | { kind: 'continueCurrent' }
  | { kind: 'localSelection'; value: string }
  | { kind: 'query'; value: string };

export interface FocusPlaybackDirective {
  operationId: string;
  action: FocusPlaybackAction;
  intent?: FocusPlaybackIntent;
}

export interface FocusDegradation {
  reason: string;
  occurredAt: number;
}

export type FocusOutcome = 'completed' | 'discarded';

export interface FocusCapture {
  id: number;
  sessionId: string;
  kind: 'note' | 'distraction';
  body: string;
  createdAt: number;
}

export interface FocusSession {
  id: string;
  intention: string;
  goal: string;
  firstAction: string;
  workflow: FocusWorkflow;
  cadence: FocusCadence;
  round: number;
  phase: FocusPhase;
  state: FocusSessionState;
  phaseStartedAt: number | null;
  phaseDeadlineAt: number | null;
  pausedRemainingMs: number | null;
  revision: number;
  musicStrategy: FocusMusicStrategy;
  degradation: FocusDegradation | null;
  outcome: FocusOutcome | null;
  captures?: FocusCapture[];
}

export type FocusEventKind =
  | 'sessionMutation'
  | 'phaseChange'
  | 'playbackDirective'
  | 'degraded';

export interface FocusEvent {
  sessionId: string;
  operationId: string;
  revision: number;
  kind: FocusEventKind;
  value: unknown;
}

export interface FocusMutationResult {
  operationId: string;
  snapshot: FocusSession;
  playbackDirective?: FocusPlaybackDirective;
}

export type FocusPlaybackFailure = 'offline' | 'unsupported' | 'failed';

export type FocusRecoveryAction = 'resume' | 'complete' | 'discard';

export interface FocusPreferences {
  defaultWorkflow: FocusWorkflow;
  defaultCadence: FocusCadence;
  defaultMusicStrategy: FocusMusicStrategy;
}

export interface FocusCommandError {
  code: string;
  details?: string;
}
