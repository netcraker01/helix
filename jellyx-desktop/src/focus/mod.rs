//! Focus domain — lifecycle service, data contracts, and persistence.
//!
//! `service.rs` implements the timestamp-based state machine, recovery,
//! replay, and playback directive logic. `models.rs` defines the
//! persisted and IPC-facing types.

pub mod models;
pub mod service;
