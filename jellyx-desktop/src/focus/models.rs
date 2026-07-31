//! Serializable Focus domain contracts shared by persistence and future IPC.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusWorkflow {
    Pomodoro,
    DeepWork,
    QuickFocus,
    Custom,
}

impl FocusWorkflow {
    /// Returns the immutable cadence for a built-in workflow.
    pub fn builtin_cadence(self) -> Option<FocusCadence> {
        match self {
            Self::Pomodoro => Some(FocusCadence {
                work_duration_ms: 25 * 60 * 1_000,
                break_duration_ms: 5 * 60 * 1_000,
                rounds: 4,
            }),
            Self::DeepWork => Some(FocusCadence {
                work_duration_ms: 90 * 60 * 1_000,
                break_duration_ms: 15 * 60 * 1_000,
                rounds: 2,
            }),
            Self::QuickFocus => Some(FocusCadence {
                work_duration_ms: 15 * 60 * 1_000,
                break_duration_ms: 0,
                rounds: 1,
            }),
            Self::Custom => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusCadence {
    pub work_duration_ms: i64,
    pub break_duration_ms: i64,
    pub rounds: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusPhase {
    Work,
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusSessionState {
    Draft,
    RunningWork,
    PausedWork,
    AwaitingTransition,
    RunningBreak,
    PausedBreak,
    Completed,
    Discarded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum FocusMusicStrategy {
    None,
    ContinueCurrent,
    Preset(String),
    Query(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusPlaybackAction {
    Play,
    Pause,
    Resume,
    Stop,
}

/// The existing player should perform this intent; Focus never owns a queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum FocusPlaybackIntent {
    ContinueCurrent,
    LocalSelection(String),
    Query(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPlaybackDirective {
    pub operation_id: String,
    pub action: FocusPlaybackAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent: Option<FocusPlaybackIntent>,
}

/// A committed Focus change delivered to clients after persistence succeeds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusEvent {
    pub session_id: String,
    pub operation_id: String,
    pub revision: i64,
    #[serde(flatten)]
    pub kind: FocusEventKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum FocusEventKind {
    SessionMutation(FocusSession),
    PhaseChange {
        phase: FocusPhase,
        state: FocusSessionState,
    },
    PlaybackDirective(FocusPlaybackDirective),
    Degraded(FocusDegradation),
}

/// Playback is best-effort and therefore separate from the persisted snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusMutationResult {
    pub operation_id: String,
    pub snapshot: FocusSession,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback_directive: Option<FocusPlaybackDirective>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusPlaybackFailure {
    Offline,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusDegradation {
    pub reason: String,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusOutcome {
    Completed,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusCaptureKind {
    Note,
    Distraction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusCapture {
    pub id: i64,
    pub session_id: String,
    pub kind: FocusCaptureKind,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub intention: String,
    pub goal: String,
    pub first_action: String,
    pub workflow: FocusWorkflow,
    pub cadence: FocusCadence,
    pub round: i32,
    pub phase: FocusPhase,
    pub state: FocusSessionState,
    pub phase_started_at: Option<i64>,
    pub phase_deadline_at: Option<i64>,
    pub paused_remaining_ms: Option<i64>,
    pub revision: i64,
    pub music_strategy: FocusMusicStrategy,
    pub degradation: Option<FocusDegradation>,
    pub outcome: Option<FocusOutcome>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub captures: Vec<FocusCapture>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPreferences {
    pub default_workflow: FocusWorkflow,
    pub default_cadence: FocusCadence,
    pub default_music_strategy: FocusMusicStrategy,
}

impl Default for FocusPreferences {
    fn default() -> Self {
        let default_workflow = FocusWorkflow::Pomodoro;
        Self {
            default_workflow,
            default_cadence: default_workflow
                .builtin_cadence()
                .expect("pomodoro is a built-in workflow"),
            default_music_strategy: FocusMusicStrategy::None,
        }
    }
}

impl FocusPreferences {
    /// Built-in workflow defaults always use their canonical code-defined cadence.
    pub fn normalized(mut self) -> Self {
        if let Some(cadence) = self.default_workflow.builtin_cadence() {
            self.default_cadence = cadence;
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FocusRecoveryAction {
    Resume,
    Complete,
    Discard,
}
