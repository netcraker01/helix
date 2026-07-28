/**
 * Focus store — reactive view over the Rust Focus backend.
 *
 * The store does NOT implement its own timer or canonical state machine.
 * It wraps IPC commands and listens to `focus-event` to reflect the latest
 * committed snapshot. UI timing derives from `phaseDeadlineAt` and the
 * local clock.
 */
import { writable, get, type Writable } from 'svelte/store';
import {
  ackFocusPlayback,
  captureFocusItem,
  degradeFocusPlayback,
  discardFocus,
  endFocus,
  getActiveFocus,
  pauseFocus,
  recoverFocus,
  resumeFocus,
  skipFocus,
  startFocusSession,
  listFocusSessions,
  deleteFocusSession,
} from '@services/focusCommands';
import { onFocusEvent } from '@features/focus/events';
import { notifications } from '@shared/stores/notifications';
import { t } from '@i18n';
import type {
  FocusEvent,
  FocusMutationResult,
  FocusPlaybackFailure,
  FocusSession,
  FocusRecoveryAction,
  FocusCadence,
  FocusMusicStrategy,
  FocusWorkflow,
  FocusPhase,
  FocusSessionState,
  FocusPlaybackDirective,
  FocusDegradation,
} from '@features/focus/types';

export interface FocusStore extends Writable<FocusState> {
  load(): Promise<void>;
  start(
    intention: string,
    goal: string,
    firstAction: string,
    workflow: FocusWorkflow,
    cadence: FocusCadence,
    musicStrategy: FocusMusicStrategy,
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  skip(): Promise<void>;
  end(): Promise<void>;
  discard(): Promise<void>;
  recover(action: FocusRecoveryAction): Promise<void>;
  captureNote(text: string): Promise<void>;
  captureDistraction(text: string): Promise<void>;
  reportPlaybackFailure(failure: FocusPlaybackFailure): Promise<void>;
  acknowledgePlayback(directiveId: string, failure?: FocusPlaybackFailure): Promise<void>;
  clear(): void;
  applyEvent(event: FocusEvent): void;
  loadHistory(): Promise<void>;
  deleteHistory(id: string): Promise<void>;
  resumeRecovery(): Promise<void>;
  discardRecovery(): Promise<void>;
  completeRecovery(): Promise<void>;
}

export interface FocusState {
  /** Latest backend snapshot; null when idle. */
  session: FocusSession | null;
  /** True while any IPC call is in flight. */
  loading: boolean;
  /** Error message from the last failed action. */
  error: string | null;
  /** Whether a recovery prompt is required (nonterminal session on open). */
  recoveryRequired: boolean;
  /** Latest playback directive emitted by the backend, awaiting execution. */
  pendingDirective: FocusMutationResult['playbackDirective'] | null;
  /** Recent completed/discarded sessions for history view. */
  history: FocusSession[];
}

const initialState: FocusState = {
  session: null,
  loading: false,
  error: null,
  recoveryRequired: false,
  pendingDirective: null,
  history: [],
};

let nextRequestId = 0;
function makeRequestId(): string {
  return `focus-ui-${Date.now()}-${++nextRequestId}`;
}

function createFocusStore(): FocusStore {
  const { subscribe, set, update } = writable<FocusState>({ ...initialState });

  function applyEvent(event: FocusEvent): void {
    update((state) => {
      switch (event.kind) {
        case 'sessionMutation':
          return {
            ...state,
            session: event.value as FocusSession,
            recoveryRequired: false,
          };
        case 'phaseChange': {
          if (event.sessionId !== state.session?.id) return state;
          if (!state.session) return state;
          const { phase, state: nextState } = event.value as { phase: FocusPhase; state: FocusSessionState };
          return {
            ...state,
            session: { ...state.session, phase, state: nextState, revision: event.revision },
          };
        }
        case 'playbackDirective':
          return { ...state, pendingDirective: event.value as FocusPlaybackDirective };
        case 'degraded': {
          if (event.sessionId !== state.session?.id) return state;
          if (!state.session) return state;
          return {
            ...state,
            session: { ...state.session, degradation: event.value as FocusDegradation, revision: event.revision },
          };
        }
        default:
          return state;
      }
    });
  }

  function setError(err: unknown): void {
    const translate = get(t);
    let msg: string;
    if (err instanceof Error) {
      msg = err.message;
    } else if (err && typeof err === 'object' && 'code' in err) {
      msg = String((err as { code: string }).code);
    } else {
      msg = String(err);
    }
    update((s) => ({ ...s, loading: false, error: msg }));
    notifications.push({ type: 'error', title: translate('focus.error_title'), message: msg, dismissible: true });
  }

  async function runMutation(call: () => Promise<FocusMutationResult>): Promise<void> {
    update((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await call();
      update((s) => ({
        ...s,
        session: result.snapshot,
        loading: false,
        pendingDirective: result.playbackDirective ?? s.pendingDirective,
        recoveryRequired: false,
      }));
    } catch (e) {
      setError(e);
    }
  }

  function requireSession(): FocusSession {
    const session = get({ subscribe }).session;
    if (!session) throw new Error('No active Focus session');
    return session;
  }

  async function captureWithStore(
    _store: FocusStore,
    kind: 'note' | 'distraction',
    text: string,
  ): Promise<void> {
    const session = requireSession();
    update((s) => ({ ...s, loading: true, error: null }));
    try {
      const snapshot = await captureFocusItem(makeRequestId(), session.id, session.revision, kind, text.trim());
      update((s) => ({ ...s, session: snapshot, loading: false }));
    } catch (e) {
      setError(e);
    }
  }

  return {
    subscribe,
    set,
    update,

    applyEvent,

    /** Load the current or recovered Focus session on route entry. */
    async load() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        let session: FocusSession | null = null;
        try {
          session = await recoverFocus();
        } catch {
          // recover failed (e.g. no DB migration yet) — try getActiveFocus
        }
        if (session) {
          update((s) => ({
            ...s,
            session,
            loading: false,
            error: null,
            recoveryRequired: true,
            pendingDirective: null,
          }));
        } else {
          let active: FocusSession | null = null;
          try {
            active = await getActiveFocus();
          } catch {
            // no active session — idle is fine
          }
          update((s) => ({
            ...s,
            session: active,
            loading: false,
            error: null,
            recoveryRequired: false,
            pendingDirective: null,
          }));
        }
      } catch (e) {
        setError(e);
      }
    },

    async start(intention, goal, firstAction, workflow, cadence, musicStrategy) {
      await runMutation(() => startFocusSession(makeRequestId(), intention, goal, firstAction, workflow, cadence, musicStrategy));
    },

    async pause() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const session = requireSession();
        await runMutation(() => pauseFocus(makeRequestId(), session.id, session.revision));
      } catch (e) {
        setError(e);
      }
    },

    async resume() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const session = requireSession();
        await runMutation(() => resumeFocus(makeRequestId(), session.id, session.revision));
      } catch (e) {
        setError(e);
      }
    },

    async skip() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const session = requireSession();
        await runMutation(() => skipFocus(makeRequestId(), session.id, session.revision));
      } catch (e) {
        setError(e);
      }
    },

    async end() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const session = requireSession();
        await runMutation(() => endFocus(makeRequestId(), session.id, session.revision));
      } catch (e) {
        setError(e);
      }
    },

    async discard() {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const session = requireSession();
        await runMutation(() => discardFocus(makeRequestId(), session.id, session.revision));
      } catch (e) {
        setError(e);
      }
    },

    async recover(action) {
      const session = requireSession();
      switch (action) {
        case 'resume':
          await runMutation(() => resumeFocus(makeRequestId(), session.id, session.revision));
          break;
        case 'complete':
          await runMutation(() => endFocus(makeRequestId(), session.id, session.revision));
          break;
        case 'discard':
          await runMutation(() => discardFocus(makeRequestId(), session.id, session.revision));
          break;
      }
    },

    async captureNote(text: string) {
      await captureWithStore(focusStore, 'note', text);
    },

    async captureDistraction(text: string) {
      await captureWithStore(focusStore, 'distraction', text);
    },

    async reportPlaybackFailure(failure) {
      const session = requireSession();
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const snapshot = await degradeFocusPlayback(makeRequestId(), session.id, session.revision, failure);
        update((s) => ({ ...s, session: snapshot, loading: false, pendingDirective: null }));
      } catch (e) {
        setError(e);
      }
    },

    async acknowledgePlayback(directiveId, failure) {
      const session = requireSession();
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const snapshot = await ackFocusPlayback(makeRequestId(), session.id, session.revision, directiveId, failure);
        update((s) => ({ ...s, session: snapshot, loading: false, pendingDirective: null }));
      } catch (e) {
        setError(e);
      }
    },

    clear() {
      set({ ...initialState });
    },

    async loadHistory() {
      try {
        const sessions = await listFocusSessions(20);
        update((s) => ({ ...s, history: sessions }));
      } catch {
        // silent — history is optional, DB may not be migrated yet
      }
    },

    async deleteHistory(id: string) {
      try {
        await deleteFocusSession(id);
        update((s) => ({ ...s, history: s.history.filter((h) => h.id !== id) }));
      } catch {
        // silent — deletion is best-effort
      }
    },

    async resumeRecovery() {
      update((s) => ({ ...s, recoveryRequired: false, loading: true, error: null }));
      try {
        const session = await recoverFocus();
        update((s) => ({ ...s, session, loading: false }));
      } catch (e) {
        setError(e);
      }
    },

    async discardRecovery() {
      const session = get({ subscribe }).session;
      if (!session) {
        update((s) => ({ ...s, recoveryRequired: false }));
        return;
      }
      try {
        const result = await discardFocus(makeRequestId(), session.id, session.revision);
        update((s) => ({ ...s, session: result.snapshot, recoveryRequired: false }));
      } catch (e) {
        setError(e);
      }
    },

    async completeRecovery() {
      const session = get({ subscribe }).session;
      if (!session) {
        update((s) => ({ ...s, recoveryRequired: false }));
        return;
      }
      try {
        const result = await endFocus(makeRequestId(), session.id, session.revision);
        update((s) => ({ ...s, session: result.snapshot, recoveryRequired: false }));
      } catch (e) {
        setError(e);
      }
    },
  };
}

export const focusStore = createFocusStore();

let unlistenFn: (() => void) | null = null;

/** Start listening to backend Focus events and feed the store. Idempotent. */
export async function startFocusListener(): Promise<() => void> {
  if (unlistenFn) return unlistenFn;
  unlistenFn = await onFocusEvent((event) => {
    focusStore.applyEvent(event);
  });
  return unlistenFn;
}

/** Stop the global Focus event listener. */
export function stopFocusListener(): void {
  unlistenFn?.();
  unlistenFn = null;
}
