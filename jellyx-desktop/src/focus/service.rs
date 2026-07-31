//! Timestamp-based Focus lifecycle service.

use std::sync::Arc;

use uuid::Uuid;

use crate::focus::models::{
    FocusCadence, FocusCaptureKind, FocusDegradation, FocusMusicStrategy, FocusMutationResult,
    FocusOutcome, FocusPhase, FocusPlaybackAction, FocusPlaybackDirective, FocusPlaybackFailure,
    FocusPlaybackIntent, FocusPreferences, FocusSession, FocusSessionState, FocusWorkflow,
};
use crate::persistence::db::Database;

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before the Unix epoch")
            .as_millis() as i64
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusServiceError {
    NotFound,
    InvalidTransition {
        state: FocusSessionState,
        action: &'static str,
    },
    Persistence(String),
}

impl std::fmt::Display for FocusServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "Focus session was not found"),
            Self::InvalidTransition { state, action } => {
                write!(f, "cannot {action} a Focus session in state {state:?}")
            }
            Self::Persistence(error) => f.write_str(error),
        }
    }
}

impl std::error::Error for FocusServiceError {}

pub struct FocusService<C: Clock = SystemClock> {
    db: Arc<Database>,
    clock: C,
}

impl<C: Clock> FocusService<C> {
    pub fn new(db: Arc<Database>, clock: C) -> Self {
        Self { db, clock }
    }

    pub fn start(
        &self,
        request_id: &str,
        intention: String,
        goal: String,
        first_action: String,
        workflow: FocusWorkflow,
        cadence: FocusCadence,
        music_strategy: FocusMusicStrategy,
    ) -> Result<FocusSession, FocusServiceError> {
        let now = self.clock.now_ms();
        let cadence = workflow.builtin_cadence().unwrap_or(cadence);
        let session = FocusSession {
            id: Uuid::new_v4().to_string(),
            intention,
            goal,
            first_action,
            workflow,
            cadence: cadence.clone(),
            round: 1,
            phase: FocusPhase::Work,
            state: FocusSessionState::RunningWork,
            phase_started_at: Some(now),
            phase_deadline_at: Some(now + cadence.work_duration_ms),
            paused_remaining_ms: None,
            revision: 0,
            music_strategy,
            degradation: None,
            outcome: None,
            captures: Vec::new(),
        };
        self.persist(request_id, "start", None, session)
    }

    pub fn preferences(&self) -> Result<FocusPreferences, FocusServiceError> {
        self.db.focus_get_preferences().map_err(persistence)
    }

    pub fn start_with_playback(
        &self,
        request_id: &str,
        intention: String,
        goal: String,
        first_action: String,
        workflow: FocusWorkflow,
        cadence: FocusCadence,
        music_strategy: FocusMusicStrategy,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.start(
            request_id,
            intention,
            goal,
            first_action,
            workflow,
            cadence,
            music_strategy,
        )?;
        self.with_playback(snapshot, request_id, FocusPlaybackAction::Play)
    }

    pub fn set_preferences(
        &self,
        preferences: FocusPreferences,
    ) -> Result<FocusPreferences, FocusServiceError> {
        self.db
            .focus_set_preferences(preferences, self.clock.now_ms())
            .map_err(persistence)
    }

    /// Record a note or distraction for the active session without mutating state.
    pub fn capture(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
        kind: FocusCaptureKind,
        body: String,
    ) -> Result<FocusSession, FocusServiceError> {
        if let Some(replay) = self
            .db
            .focus_get_operation_result(request_id)
            .map_err(persistence)?
        {
            return Ok(replay);
        }
        let mut session = self
            .db
            .focus_get_session(id)
            .map_err(persistence)?
            .ok_or(FocusServiceError::NotFound)?;
        if session.revision != expected_revision {
            return Err(FocusServiceError::Persistence(
                "stale focus revision".to_string(),
            ));
        }
        let now = self.clock.now_ms();
        let kind_name = match kind {
            FocusCaptureKind::Note => "note",
            FocusCaptureKind::Distraction => "distraction",
        };
        let capture = self
            .db
            .focus_capture(id, kind_name, &body, now)
            .map_err(persistence)?;
        session.captures.push(capture);
        session.revision += 1;
        self.persist(request_id, "capture", Some(expected_revision), session)
    }

    pub fn pause(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "pause",
            |session, now| match session.state {
                FocusSessionState::RunningWork | FocusSessionState::RunningBreak => {
                    session.paused_remaining_ms =
                        Some((session.phase_deadline_at.unwrap_or(now) - now).max(0));
                    session.phase_started_at = None;
                    session.phase_deadline_at = None;
                    session.state = if session.phase == FocusPhase::Work {
                        FocusSessionState::PausedWork
                    } else {
                        FocusSessionState::PausedBreak
                    };
                    Ok(())
                }
                state => Err(FocusServiceError::InvalidTransition {
                    state,
                    action: "pause",
                }),
            },
        )
    }

    pub fn pause_with_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.pause(request_id, id, expected_revision)?;
        self.with_playback(snapshot, request_id, FocusPlaybackAction::Pause)
    }

    pub fn resume(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "resume",
            |session, now| match session.state {
                FocusSessionState::PausedWork | FocusSessionState::PausedBreak => {
                    let remaining = session.paused_remaining_ms.unwrap_or(0);
                    session.phase_started_at = Some(now);
                    session.phase_deadline_at = Some(now + remaining);
                    session.paused_remaining_ms = None;
                    session.state = if session.phase == FocusPhase::Work {
                        FocusSessionState::RunningWork
                    } else {
                        FocusSessionState::RunningBreak
                    };
                    Ok(())
                }
                state => Err(FocusServiceError::InvalidTransition {
                    state,
                    action: "resume",
                }),
            },
        )
    }

    pub fn resume_with_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.resume(request_id, id, expected_revision)?;
        self.with_playback(snapshot, request_id, FocusPlaybackAction::Resume)
    }

    pub fn skip(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "skip",
            |session, now| match session.state {
                FocusSessionState::AwaitingTransition
                | FocusSessionState::RunningWork
                | FocusSessionState::PausedWork
                | FocusSessionState::RunningBreak
                | FocusSessionState::PausedBreak => skip_phase(session, now),
                state => Err(FocusServiceError::InvalidTransition {
                    state,
                    action: "skip",
                }),
            },
        )
    }

    pub fn skip_with_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.skip(request_id, id, expected_revision)?;
        let action = if matches!(snapshot.state, FocusSessionState::Completed) {
            FocusPlaybackAction::Stop
        } else {
            FocusPlaybackAction::Resume
        };
        self.with_playback(snapshot, request_id, action)
    }

    pub fn end(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "end",
            |session, _| match session.state {
                FocusSessionState::Completed | FocusSessionState::Discarded => {
                    Err(FocusServiceError::InvalidTransition {
                        state: session.state,
                        action: "end",
                    })
                }
                _ => complete(session),
            },
        )
    }

    pub fn end_with_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.end(request_id, id, expected_revision)?;
        self.with_playback(snapshot, request_id, FocusPlaybackAction::Stop)
    }

    pub fn discard(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "discard",
            |session, _| match session.state {
                FocusSessionState::Completed | FocusSessionState::Discarded => {
                    Err(FocusServiceError::InvalidTransition {
                        state: session.state,
                        action: "discard",
                    })
                }
                _ => discard(session),
            },
        )
    }

    pub fn discard_with_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let snapshot = self.discard(request_id, id, expected_revision)?;
        self.with_playback(snapshot, request_id, FocusPlaybackAction::Stop)
    }

    /// Record a bounded failure without changing phase, timers, or outcome.
    pub fn degrade_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
        failure: FocusPlaybackFailure,
    ) -> Result<FocusSession, FocusServiceError> {
        self.mutate(
            request_id,
            id,
            expected_revision,
            "playbackFailure",
            |session, now| {
                session.degradation = Some(FocusDegradation {
                    reason: failure_reason(failure).to_string(),
                    occurred_at: now,
                });
                Ok(())
            },
        )
    }

    /// Persist a correlated playback acknowledgement. Acknowledgements only
    /// apply to the exact directive snapshot; duplicate request IDs replay.
    pub fn acknowledge_playback(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
        directive_id: &str,
        failure: Option<FocusPlaybackFailure>,
    ) -> Result<FocusSession, FocusServiceError> {
        if let Some(replay) = self
            .db
            .focus_get_operation_result(request_id)
            .map_err(persistence)?
        {
            return Ok(replay);
        }
        if !self
            .db
            .focus_is_playback_directive(directive_id)
            .map_err(persistence)?
        {
            return Err(FocusServiceError::InvalidTransition {
                state: FocusSessionState::Draft,
                action: "acknowledge unknown playback directive",
            });
        }
        let directive = self
            .db
            .focus_get_operation_result(directive_id)
            .map_err(persistence)?
            .ok_or(FocusServiceError::InvalidTransition {
                state: FocusSessionState::Draft,
                action: "acknowledge unknown playback directive",
            })?;
        if directive.id != id {
            return Err(FocusServiceError::InvalidTransition {
                state: directive.state,
                action: "acknowledge playback directive for a different session",
            });
        }
        self.mutate(
            request_id,
            id,
            expected_revision,
            "playbackAck",
            |session, now| {
                if let Some(failure) = failure {
                    session.degradation = Some(FocusDegradation {
                        reason: failure_reason(failure).to_string(),
                        occurred_at: now,
                    });
                }
                Ok(())
            },
        )
    }

    pub fn recover(&self) -> Result<Option<FocusSession>, FocusServiceError> {
        let Some(session) = self
            .db
            .focus_get_nonterminal_session()
            .map_err(persistence)?
        else {
            return Ok(None);
        };
        if is_expired(&session, self.clock.now_ms()) {
            let revision = session.revision;
            return self
                .mutate(
                    &format!("recovery-advance-{}-{revision}", session.id),
                    &session.id,
                    revision,
                    "autoAdvance",
                    |session, now| skip_phase(session, now),
                )
                .map(Some);
        }
        Ok(Some(session))
    }

    /// Return recent completed/discarded sessions for history view.
    pub fn list_sessions(&self, limit: u32) -> Result<Vec<FocusSession>, FocusServiceError> {
        self.db.focus_list_sessions(limit).map_err(persistence)
    }

    pub fn delete_session(&self, id: &str) -> Result<(), FocusServiceError> {
        self.db.focus_delete_session(id).map_err(persistence)
    }

    fn mutate<F>(
        &self,
        request_id: &str,
        id: &str,
        expected_revision: i64,
        operation: &str,
        change: F,
    ) -> Result<FocusSession, FocusServiceError>
    where
        F: FnOnce(&mut FocusSession, i64) -> Result<(), FocusServiceError>,
    {
        if let Some(replay) = self
            .db
            .focus_get_operation_result(request_id)
            .map_err(persistence)?
        {
            return Ok(replay);
        }
        let now = self.clock.now_ms();
        let mut session = self
            .db
            .focus_get_session(id)
            .map_err(persistence)?
            .ok_or(FocusServiceError::NotFound)?;
        if is_expired(&session, now) {
            expire(&mut session);
            // Reconcile elapsed time before applying an explicit terminal action.
            // `end` must win over the intermediate awaiting-transition state so its
            // idempotency receipt records the terminal snapshot.
            // `autoAdvance` skips the expired phase to start the next one.
            if matches!(operation, "end" | "discard" | "autoAdvance") {
                change(&mut session, now)?;
            }
        } else {
            change(&mut session, now)?;
        }
        session.revision += 1;
        self.persist(request_id, operation, Some(expected_revision), session)
    }

    fn persist(
        &self,
        request_id: &str,
        operation: &str,
        expected_revision: Option<i64>,
        session: FocusSession,
    ) -> Result<FocusSession, FocusServiceError> {
        self.db
            .focus_apply_session(
                request_id,
                &Uuid::new_v4().to_string(),
                operation,
                expected_revision,
                &session,
                self.clock.now_ms(),
            )
            .map_err(persistence)
    }

    fn with_playback(
        &self,
        snapshot: FocusSession,
        operation_id: &str,
        action: FocusPlaybackAction,
    ) -> Result<FocusMutationResult, FocusServiceError> {
        let intent = match (&snapshot.music_strategy, action) {
            (FocusMusicStrategy::None, _) => {
                return Ok(FocusMutationResult {
                    operation_id: operation_id.to_string(),
                    snapshot,
                    playback_directive: None,
                });
            }
            (FocusMusicStrategy::ContinueCurrent, FocusPlaybackAction::Play) => {
                Some(FocusPlaybackIntent::ContinueCurrent)
            }
            (FocusMusicStrategy::Preset(value), FocusPlaybackAction::Play) => {
                Some(FocusPlaybackIntent::LocalSelection(value.clone()))
            }
            (FocusMusicStrategy::Query(value), FocusPlaybackAction::Play) => {
                Some(FocusPlaybackIntent::Query(value.clone()))
            }
            _ => None,
        };
        self.db
            .focus_mark_playback_directive(operation_id)
            .map_err(persistence)?;
        Ok(FocusMutationResult {
            operation_id: operation_id.to_string(),
            snapshot,
            playback_directive: Some(FocusPlaybackDirective {
                operation_id: operation_id.to_string(),
                action,
                intent,
            }),
        })
    }
}

fn failure_reason(failure: FocusPlaybackFailure) -> &'static str {
    match failure {
        FocusPlaybackFailure::Offline => "offline",
        FocusPlaybackFailure::Unsupported => "unsupported",
        FocusPlaybackFailure::Failed => "failed",
    }
}

fn is_expired(session: &FocusSession, now: i64) -> bool {
    matches!(
        session.state,
        FocusSessionState::RunningWork | FocusSessionState::RunningBreak
    ) && session
        .phase_deadline_at
        .is_some_and(|deadline| now >= deadline)
}

fn expire(session: &mut FocusSession) {
    session.state = FocusSessionState::AwaitingTransition;
    session.phase_started_at = None;
    session.phase_deadline_at = None;
    session.paused_remaining_ms = None;
}
fn complete(session: &mut FocusSession) -> Result<(), FocusServiceError> {
    session.state = FocusSessionState::Completed;
    session.outcome = Some(FocusOutcome::Completed);
    session.phase_started_at = None;
    session.phase_deadline_at = None;
    session.paused_remaining_ms = None;
    Ok(())
}
fn discard(session: &mut FocusSession) -> Result<(), FocusServiceError> {
    session.state = FocusSessionState::Discarded;
    session.outcome = Some(FocusOutcome::Discarded);
    session.phase_started_at = None;
    session.phase_deadline_at = None;
    session.paused_remaining_ms = None;
    Ok(())
}

/// Skip the current phase and advance to the next one (or complete).
fn skip_phase(session: &mut FocusSession, now: i64) -> Result<(), FocusServiceError> {
    match session.phase {
        FocusPhase::Work if session.round >= session.cadence.rounds => complete(session),
        FocusPhase::Work if session.cadence.break_duration_ms > 0 => {
            run_phase(session, FocusPhase::Break, now)
        }
        FocusPhase::Work => {
            session.round += 1;
            run_phase(session, FocusPhase::Work, now)
        }
        FocusPhase::Break => {
            session.round += 1;
            run_phase(session, FocusPhase::Work, now)
        }
    }
}

fn run_phase(
    session: &mut FocusSession,
    phase: FocusPhase,
    now: i64,
) -> Result<(), FocusServiceError> {
    let duration = if phase == FocusPhase::Work {
        session.cadence.work_duration_ms
    } else {
        session.cadence.break_duration_ms
    };
    session.phase = phase;
    session.phase_started_at = Some(now);
    session.phase_deadline_at = Some(now + duration);
    session.paused_remaining_ms = None;
    session.state = if phase == FocusPhase::Work {
        FocusSessionState::RunningWork
    } else {
        FocusSessionState::RunningBreak
    };
    Ok(())
}
fn persistence(error: crate::errors::types::PersistenceError) -> FocusServiceError {
    let message = match error {
        crate::errors::types::PersistenceError::DatabaseError(message)
        | crate::errors::types::PersistenceError::WriteError(message) => message,
    };
    FocusServiceError::Persistence(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct FakeClock(Arc<Mutex<i64>>);
    impl FakeClock {
        fn new(now: i64) -> Self {
            Self(Arc::new(Mutex::new(now)))
        }
        fn set(&self, now: i64) {
            *self.0.lock().unwrap() = now;
        }
    }
    impl Clock for FakeClock {
        fn now_ms(&self) -> i64 {
            *self.0.lock().unwrap()
        }
    }
    fn service(now: i64) -> (FocusService<FakeClock>, FakeClock) {
        let clock = FakeClock::new(now);
        (
            FocusService::new(Arc::new(Database::open_in_memory().unwrap()), clock.clone()),
            clock,
        )
    }
    fn cadence() -> FocusCadence {
        FocusCadence {
            work_duration_ms: 100,
            break_duration_ms: 50,
            rounds: 2,
        }
    }
    fn start(service: &FocusService<FakeClock>) -> FocusSession {
        service
            .start(
                "start",
                "Write tests".into(),
                String::new(),
                String::new(),
                FocusWorkflow::Custom,
                cadence(),
                FocusMusicStrategy::None,
            )
            .unwrap()
    }

    #[test]
    fn captures_persist_with_session() {
        let (service, _) = service(0);
        let started = start(&service);
        let with_note = service
            .capture(
                "cap-note",
                &started.id,
                0,
                FocusCaptureKind::Note,
                "Milestone".into(),
            )
            .unwrap();
        assert_eq!(with_note.captures.len(), 1);
        assert_eq!(with_note.captures[0].kind, FocusCaptureKind::Note);
        assert_eq!(with_note.captures[0].body, "Milestone");
        assert_eq!(with_note.revision, 1);

        let recovered = service.recover().unwrap().unwrap();
        assert_eq!(recovered.captures.len(), 1);
        assert_eq!(recovered.captures[0].body, "Milestone");

        let with_distraction = service
            .capture(
                "cap-distraction",
                &started.id,
                1,
                FocusCaptureKind::Distraction,
                "Noise".into(),
            )
            .unwrap();
        assert_eq!(with_distraction.captures.len(), 2);
        assert_eq!(
            with_distraction.captures[1].kind,
            FocusCaptureKind::Distraction
        );

        let replay = service
            .capture(
                "cap-note",
                &started.id,
                0,
                FocusCaptureKind::Note,
                "Milestone".into(),
            )
            .unwrap();
        assert_eq!(replay.captures.len(), 1);
    }

    #[test]
    fn captures_reject_stale_revision() {
        let (service, _) = service(0);
        let started = start(&service);
        service
            .capture(
                "cap-note",
                &started.id,
                0,
                FocusCaptureKind::Note,
                "Milestone".into(),
            )
            .unwrap();
        assert!(matches!(
            service.capture(
                "cap-note-2",
                &started.id,
                0,
                FocusCaptureKind::Note,
                "Again".into()
            ),
            Err(FocusServiceError::Persistence(_))
        ));
    }

    #[test]
    fn starts_pauses_and_resumes_from_timestamps() {
        let (service, clock) = service(1_000);
        let started = start(&service);
        clock.set(1_040);
        let paused = service.pause("pause", &started.id, 0).unwrap();
        assert_eq!(paused.paused_remaining_ms, Some(60));
        clock.set(5_000);
        let resumed = service.resume("resume", &started.id, 1).unwrap();
        assert_eq!(
            (
                resumed.phase_started_at,
                resumed.phase_deadline_at,
                resumed.state
            ),
            (Some(5_000), Some(5_060), FocusSessionState::RunningWork)
        );
    }
    #[test]
    fn expiry_becomes_awaiting_once_then_skip_starts_break() {
        let (service, clock) = service(0);
        let started = start(&service);
        clock.set(100);
        let expired = service.pause("expire", &started.id, 0).unwrap();
        assert_eq!(expired.state, FocusSessionState::AwaitingTransition);
        let break_session = service.skip("skip", &started.id, 1).unwrap();
        assert_eq!(
            (
                break_session.phase,
                break_session.state,
                break_session.phase_deadline_at
            ),
            (
                FocusPhase::Break,
                FocusSessionState::RunningBreak,
                Some(150)
            )
        );
    }
    #[test]
    fn transitions_reject_invalid_actions_and_end_is_terminal() {
        let (service, _) = service(0);
        let started = start(&service);
        assert!(matches!(
            service.resume("resume", &started.id, 0),
            Err(FocusServiceError::InvalidTransition { .. })
        ));
        let ended = service.end("end", &started.id, 0).unwrap();
        assert_eq!(
            (ended.state, ended.outcome),
            (FocusSessionState::Completed, Some(FocusOutcome::Completed))
        );
        assert!(matches!(
            service.end("again", &started.id, 1),
            Err(FocusServiceError::InvalidTransition { .. })
        ));
    }
    #[test]
    fn end_at_or_after_deadline_completes_and_replays_the_terminal_result() {
        for (name, now) in [("at deadline", 100), ("after deadline", 101)] {
            let (service, clock) = service(0);
            let started = start(&service);
            clock.set(now);

            let ended = service.end("end", &started.id, 0).unwrap();

            assert_eq!(
                (ended.state, ended.outcome, ended.revision),
                (
                    FocusSessionState::Completed,
                    Some(FocusOutcome::Completed),
                    1
                ),
                "{name}"
            );
            assert_eq!(service.end("end", &started.id, 0).unwrap(), ended, "{name}");
            assert_eq!(
                service
                    .db
                    .focus_get_session(&started.id)
                    .unwrap()
                    .unwrap()
                    .revision,
                ended.revision,
                "{name}"
            );
        }
    }
    #[test]
    fn active_session_remains_recoverable_without_an_explicit_terminal_action() {
        let (service, _) = service(0);
        let started = start(&service);

        let recovered = service.recover().unwrap().unwrap();

        assert_eq!(recovered.id, started.id);
        assert_eq!(recovered.state, FocusSessionState::RunningWork);
        assert_eq!(recovered.outcome, None);
        assert!(service.list_sessions(10).unwrap().is_empty());
    }
    #[test]
    fn duplicate_request_replays_original_mutation() {
        let (service, clock) = service(0);
        let started = start(&service);
        clock.set(20);
        let paused = service.pause("pause", &started.id, 0).unwrap();
        clock.set(50);
        let replay = service.pause("pause", &started.id, 0).unwrap();
        assert_eq!(replay, paused);
    }

    #[test]
    fn playback_directives_are_typed_and_no_music_is_silent() {
        let (initial_service, _) = service(0);
        let none = initial_service
            .start_with_playback(
                "none",
                "Write".into(),
                String::new(),
                String::new(),
                FocusWorkflow::Custom,
                cadence(),
                FocusMusicStrategy::None,
            )
            .unwrap();
        assert_eq!(none.playback_directive, None);

        for (request_id, strategy, intent) in [
            (
                "continue",
                FocusMusicStrategy::ContinueCurrent,
                FocusPlaybackIntent::ContinueCurrent,
            ),
            (
                "preset",
                FocusMusicStrategy::Preset("library:focus".into()),
                FocusPlaybackIntent::LocalSelection("library:focus".into()),
            ),
            (
                "query",
                FocusMusicStrategy::Query("ambient focus".into()),
                FocusPlaybackIntent::Query("ambient focus".into()),
            ),
        ] {
            let (service, _) = service(0);
            let result = service
                .start_with_playback(
                    request_id,
                    "Write".into(),
                    String::new(),
                    String::new(),
                    FocusWorkflow::Custom,
                    cadence(),
                    strategy,
                )
                .unwrap();
            assert_eq!(
                result.playback_directive,
                Some(FocusPlaybackDirective {
                    operation_id: request_id.into(),
                    action: FocusPlaybackAction::Play,
                    intent: Some(intent),
                })
            );
        }
    }

    #[test]
    fn acknowledgement_rejects_a_no_music_start_receipt_without_mutation() {
        let (service, _) = service(0);
        let started = service
            .start_with_playback(
                "no-music-start",
                "Write".into(),
                String::new(),
                String::new(),
                FocusWorkflow::Custom,
                cadence(),
                FocusMusicStrategy::None,
            )
            .unwrap();

        assert!(matches!(
            service.acknowledge_playback(
                "no-music-ack",
                &started.snapshot.id,
                0,
                "no-music-start",
                Some(FocusPlaybackFailure::Offline),
            ),
            Err(FocusServiceError::InvalidTransition { .. })
        ));
        assert_eq!(
            service.db.focus_get_session(&started.snapshot.id).unwrap(),
            Some(started.snapshot)
        );
    }

    #[test]
    fn playback_failures_degrade_without_rolling_back_focus() {
        for failure in [
            FocusPlaybackFailure::Offline,
            FocusPlaybackFailure::Unsupported,
            FocusPlaybackFailure::Failed,
        ] {
            let (service, clock) = service(0);
            let started = service
                .start_with_playback(
                    "start",
                    "Write".into(),
                    String::new(),
                    String::new(),
                    FocusWorkflow::Custom,
                    cadence(),
                    FocusMusicStrategy::ContinueCurrent,
                )
                .unwrap();
            clock.set(10);
            let degraded = service
                .degrade_playback("failure", &started.snapshot.id, 0, failure)
                .unwrap();
            assert_eq!(degraded.state, FocusSessionState::RunningWork);
            assert_eq!(
                degraded.phase_deadline_at,
                started.snapshot.phase_deadline_at
            );
            assert_eq!(degraded.revision, 1);
            assert_eq!(degraded.degradation.unwrap().occurred_at, 10);
        }
    }

    #[test]
    fn playback_acknowledgements_replay_and_reject_stale_directives() {
        let (service, clock) = service(0);
        let started = service
            .start_with_playback(
                "directive",
                "Write".into(),
                String::new(),
                String::new(),
                FocusWorkflow::Custom,
                cadence(),
                FocusMusicStrategy::ContinueCurrent,
            )
            .unwrap();
        clock.set(10);
        let acknowledged = service
            .acknowledge_playback(
                "ack",
                &started.snapshot.id,
                0,
                "directive",
                Some(FocusPlaybackFailure::Offline),
            )
            .unwrap();
        assert_eq!(acknowledged.revision, 1);
        assert_eq!(acknowledged.degradation.as_ref().unwrap().reason, "offline");
        assert_eq!(
            service
                .acknowledge_playback("ack", &started.snapshot.id, 0, "directive", None)
                .unwrap(),
            acknowledged
        );
        let newer = service.pause("pause", &started.snapshot.id, 1).unwrap();
        assert!(matches!(
            service.acknowledge_playback("late", &started.snapshot.id, 0, "directive", None),
            Err(FocusServiceError::InvalidTransition { .. } | FocusServiceError::Persistence(_))
        ));
        assert_eq!(
            service.db.focus_get_session(&started.snapshot.id).unwrap(),
            Some(newer)
        );
    }

    #[test]
    fn lifecycle_directives_pause_resume_and_stop_without_queue_mutation() {
        let (service, clock) = service(0);
        let started = service
            .start_with_playback(
                "start",
                "Write".into(),
                String::new(),
                String::new(),
                FocusWorkflow::Custom,
                cadence(),
                FocusMusicStrategy::ContinueCurrent,
            )
            .unwrap();
        let paused = service
            .pause_with_playback("pause", &started.snapshot.id, 0)
            .unwrap();
        assert_eq!(
            paused.playback_directive.unwrap().action,
            FocusPlaybackAction::Pause
        );
        let resumed = service
            .resume_with_playback("resume", &started.snapshot.id, 1)
            .unwrap();
        assert_eq!(
            resumed.playback_directive.unwrap().action,
            FocusPlaybackAction::Resume
        );

        clock.set(100);
        let waiting = service.pause("expire", &started.snapshot.id, 2).unwrap();
        let advanced = service
            .skip_with_playback("skip", &started.snapshot.id, waiting.revision)
            .unwrap();
        assert_eq!(
            advanced.playback_directive.unwrap().action,
            FocusPlaybackAction::Resume
        );
        let ended = service
            .end_with_playback("end", &started.snapshot.id, advanced.snapshot.revision)
            .unwrap();
        assert_eq!(
            ended.playback_directive.unwrap().action,
            FocusPlaybackAction::Stop
        );
    }
    #[test]
    fn recovery_advances_expired_work_to_break() {
        let (service, clock) = service(0);
        let started = start(&service);
        assert_eq!(service.recover().unwrap().unwrap().id, started.id);
        clock.set(100);
        let recovered = service.recover().unwrap().unwrap();
        assert_eq!(recovered.state, FocusSessionState::RunningBreak);
        assert_eq!(recovered.phase, FocusPhase::Break);
        // Second recover is idempotent (break not yet expired at t=100).
        assert_eq!(
            service.recover().unwrap().unwrap().revision,
            recovered.revision
        );
    }

    #[test]
    fn builtins_are_canonical_and_preferences_roundtrip() {
        let (service, _) = service(0);
        let expected = FocusCadence {
            work_duration_ms: 1_500_000,
            break_duration_ms: 300_000,
            rounds: 4,
        };

        assert_eq!(
            FocusWorkflow::Pomodoro.builtin_cadence(),
            Some(expected.clone())
        );
        assert_eq!(service.preferences().unwrap().default_cadence, expected);

        let preferences = FocusPreferences {
            default_workflow: FocusWorkflow::QuickFocus,
            default_cadence: FocusCadence {
                work_duration_ms: 1,
                break_duration_ms: 1,
                rounds: 1,
            },
            default_music_strategy: FocusMusicStrategy::ContinueCurrent,
        };
        let saved = service.set_preferences(preferences).unwrap();
        assert_eq!(
            saved.default_cadence,
            FocusWorkflow::QuickFocus.builtin_cadence().unwrap()
        );
        assert_eq!(service.preferences().unwrap(), saved);
    }

    #[test]
    fn builtins_override_caller_cadence_when_starting() {
        let (service, _) = service(0);
        let session = service
            .start(
                "builtin-start",
                "Write tests".into(),
                String::new(),
                String::new(),
                FocusWorkflow::DeepWork,
                FocusCadence {
                    work_duration_ms: 1,
                    break_duration_ms: 1,
                    rounds: 1,
                },
                FocusMusicStrategy::None,
            )
            .unwrap();

        assert_eq!(
            session.cadence,
            FocusCadence {
                work_duration_ms: 90 * 60 * 1_000,
                break_duration_ms: 15 * 60 * 1_000,
                rounds: 2,
            }
        );
    }

    #[test]
    fn stale_revisions_fail_at_the_service_without_creating_a_receipt() {
        let (service, _) = service(0);
        let started = start(&service);

        assert!(matches!(
            service.pause("stale-pause", &started.id, 7),
            Err(FocusServiceError::Persistence(message)) if message.contains("stale")
        ));
        assert_eq!(
            service.db.focus_get_session(&started.id).unwrap(),
            Some(started)
        );
        assert_eq!(
            service
                .db
                .focus_get_operation_result("stale-pause")
                .unwrap(),
            None
        );
    }

    #[test]
    fn complete_transition_table_covers_documented_states_and_actions() {
        for (setup, action, expected) in [
            ("running work", "pause", Some(FocusSessionState::PausedWork)),
            ("running work", "resume", None),
            (
                "running work",
                "skip",
                Some(FocusSessionState::RunningBreak),
            ),
            ("running work", "end", Some(FocusSessionState::Completed)),
            (
                "running work",
                "discard",
                Some(FocusSessionState::Discarded),
            ),
            ("paused work", "pause", None),
            (
                "paused work",
                "resume",
                Some(FocusSessionState::RunningWork),
            ),
            ("paused work", "skip", Some(FocusSessionState::RunningBreak)),
            ("paused work", "end", Some(FocusSessionState::Completed)),
            ("paused work", "discard", Some(FocusSessionState::Discarded)),
            ("awaiting work", "pause", None),
            ("awaiting work", "resume", None),
            (
                "awaiting work",
                "skip",
                Some(FocusSessionState::RunningBreak),
            ),
            ("awaiting work", "end", Some(FocusSessionState::Completed)),
            (
                "awaiting work",
                "discard",
                Some(FocusSessionState::Discarded),
            ),
            (
                "running break",
                "pause",
                Some(FocusSessionState::PausedBreak),
            ),
            ("running break", "resume", None),
            (
                "running break",
                "skip",
                Some(FocusSessionState::RunningWork),
            ),
            ("running break", "end", Some(FocusSessionState::Completed)),
            (
                "running break",
                "discard",
                Some(FocusSessionState::Discarded),
            ),
            ("paused break", "pause", None),
            (
                "paused break",
                "resume",
                Some(FocusSessionState::RunningBreak),
            ),
            ("paused break", "skip", Some(FocusSessionState::RunningWork)),
            ("paused break", "end", Some(FocusSessionState::Completed)),
            (
                "paused break",
                "discard",
                Some(FocusSessionState::Discarded),
            ),
            ("awaiting break", "pause", None),
            ("awaiting break", "resume", None),
            (
                "awaiting break",
                "skip",
                Some(FocusSessionState::RunningWork),
            ),
            ("awaiting break", "end", Some(FocusSessionState::Completed)),
            (
                "awaiting break",
                "discard",
                Some(FocusSessionState::Discarded),
            ),
            ("completed", "pause", None),
            ("completed", "resume", None),
            ("completed", "skip", None),
            ("completed", "end", None),
            ("completed", "discard", None),
            ("discarded", "pause", None),
            ("discarded", "resume", None),
            ("discarded", "skip", None),
            ("discarded", "end", None),
            ("discarded", "discard", None),
            (
                "final awaiting work",
                "skip",
                Some(FocusSessionState::Completed),
            ),
        ] {
            let (service, clock) = service(0);
            let started = start(&service);
            let prepared = match setup {
                "running work" => started,
                "paused work" => service.pause("setup-pause", &started.id, 0).unwrap(),
                "awaiting work" => {
                    clock.set(100);
                    service.pause("setup-expire", &started.id, 0).unwrap()
                }
                "running break" => {
                    clock.set(100);
                    let awaiting = service.pause("setup-expire", &started.id, 0).unwrap();
                    service
                        .skip("setup-break", &started.id, awaiting.revision)
                        .unwrap()
                }
                "paused break" => {
                    clock.set(100);
                    let awaiting = service.pause("setup-expire", &started.id, 0).unwrap();
                    let break_session = service
                        .skip("setup-break", &started.id, awaiting.revision)
                        .unwrap();
                    service
                        .pause("setup-break-pause", &started.id, break_session.revision)
                        .unwrap()
                }
                "awaiting break" => {
                    clock.set(100);
                    let awaiting = service.pause("setup-expire", &started.id, 0).unwrap();
                    let break_session = service
                        .skip("setup-break", &started.id, awaiting.revision)
                        .unwrap();
                    clock.set(150);
                    service
                        .pause("setup-break-expire", &started.id, break_session.revision)
                        .unwrap()
                }
                "completed" => service.end("setup-end", &started.id, 0).unwrap(),
                "discarded" => service.discard("setup-discard", &started.id, 0).unwrap(),
                "final awaiting work" => {
                    clock.set(100);
                    let awaiting = service.pause("setup-expire", &started.id, 0).unwrap();
                    let break_session = service
                        .skip("setup-break", &started.id, awaiting.revision)
                        .unwrap();
                    clock.set(150);
                    let awaiting_break = service
                        .pause("setup-break-expire", &started.id, break_session.revision)
                        .unwrap();
                    let final_work = service
                        .skip("setup-final-work", &started.id, awaiting_break.revision)
                        .unwrap();
                    clock.set(250);
                    service
                        .pause("setup-final-expire", &started.id, final_work.revision)
                        .unwrap()
                }
                _ => unreachable!(),
            };
            let result = match action {
                "pause" => service.pause("action", &prepared.id, prepared.revision),
                "resume" => service.resume("action", &prepared.id, prepared.revision),
                "skip" => service.skip("action", &prepared.id, prepared.revision),
                "end" => service.end("action", &prepared.id, prepared.revision),
                "discard" => service.discard("action", &prepared.id, prepared.revision),
                _ => unreachable!(),
            };

            match expected {
                Some(state) => assert_eq!(result.unwrap().state, state, "{setup}: {action}"),
                None => assert!(
                    matches!(result, Err(FocusServiceError::InvalidTransition { .. })),
                    "{setup}: {action}"
                ),
            }
        }
    }
}
