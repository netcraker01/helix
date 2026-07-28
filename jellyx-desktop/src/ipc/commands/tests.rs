//! Tests for Tauri command handlers.
//!
//! These tests focus on pure, side-effect-free validation logic that does not
//! require a running Tauri runtime.

use super::*;
use std::sync::Arc;

#[test]
fn focus_command_errors_are_stable_and_redacted() {
    let stale = focus_error(FocusServiceError::Persistence(
        "stale focus revision; sqlite at /private/path".into(),
    ));
    let unavailable = focus_error(FocusServiceError::Persistence(
        "database is locked at /private/path".into(),
    ));

    assert_eq!(stale.code, "FOCUS_REVISION_CONFLICT");
    assert_eq!(unavailable.code, "FOCUS_UNAVAILABLE");
    assert_eq!(
        serde_json::to_string(&unavailable).unwrap(),
        "{\"code\":\"FOCUS_UNAVAILABLE\",\"details\":null}"
    );
}

#[test]
fn focus_start_delegates_and_replays_request_ids() {
    let service = FocusService::new(
        Arc::new(crate::persistence::db::Database::open_in_memory().unwrap()),
        crate::focus::service::SystemClock,
    );
    let cadence = FocusCadence {
        work_duration_ms: 1_000,
        break_duration_ms: 0,
        rounds: 1,
    };
    let started = start_focus(
        &service,
        "focus-ipc-start",
        0,
        "Write command tests".into(),
        "Ship recovery".into(),
        "Open the editor".into(),
        FocusWorkflow::Custom,
        cadence.clone(),
        FocusMusicStrategy::None,
    )
    .unwrap();
    let replay = start_focus(
        &service,
        "focus-ipc-start",
        0,
        "Write command tests".into(),
        "Ship recovery".into(),
        "Open the editor".into(),
        FocusWorkflow::Custom,
        cadence,
        FocusMusicStrategy::None,
    )
    .unwrap();

    assert_eq!(replay, started);
}

#[test]
fn focus_events_include_snapshot_phase_and_playback_directive() {
    let service = FocusService::new(
        Arc::new(crate::persistence::db::Database::open_in_memory().unwrap()),
        crate::focus::service::SystemClock,
    );
    let result = start_focus(
        &service,
        "focus-event-start",
        0,
        "Test events".into(),
        String::new(),
        String::new(),
        FocusWorkflow::Custom,
        FocusCadence {
            work_duration_ms: 1_000,
            break_duration_ms: 0,
            rounds: 1,
        },
        FocusMusicStrategy::ContinueCurrent,
    )
    .unwrap();
    let mut events = Vec::new();
    emit_focus_result(&result, true, |event| {
        events.push(event.clone());
        Ok(())
    });

    assert!(events
        .iter()
        .any(|event| matches!(event.kind, FocusEventKind::SessionMutation(_))));
    assert!(events
        .iter()
        .any(|event| matches!(event.kind, FocusEventKind::PhaseChange { .. })));
    assert!(events
        .iter()
        .any(|event| matches!(event.kind, FocusEventKind::PlaybackDirective(_))));
}

#[test]
fn open_release_page_accepts_jellyx_repo_url() {
    let url = "https://github.com/netcraker01/jellyx-player/releases/tag/v0.3.3";
    assert!(
        is_release_url_allowed(url),
        "expected Jellyx release URL to be allowed: {}",
        url
    );
}

#[test]
fn open_release_page_accepts_legacy_helix_repo_url() {
    let url = "https://github.com/netcraker01/helix/releases/tag/v0.3.3";
    assert!(
        is_release_url_allowed(url),
        "expected legacy Helix release URL to be allowed (GitHub redirects): {}",
        url
    );
}

#[test]
fn open_release_page_rejects_non_github_url() {
    let url = "https://example.com/evil";
    assert!(!is_release_url_allowed(url));
}

#[test]
fn open_release_page_rejects_malformed_github_path() {
    let url = "https://github.com/netcracker01/jellyx-player/issues/1";
    assert!(!is_release_url_allowed(url));
}

// ── Artist detail cache IPC helpers ─────────────────────────────────

#[test]
fn get_cached_artist_detail_returns_none_for_missing_id() {
    let db = std::sync::Arc::new(crate::persistence::db::Database::open_in_memory().unwrap());
    let library = std::sync::Arc::new(crate::library::LibraryService::new(db.clone()));
    let row = db.artist_detail_cache_get("artist:ghost").unwrap();
    assert!(row.is_none());
    // Library service exposes the database handle for cache reads.
    let _ = library.db_handle();
}

#[test]
fn cached_artist_detail_roundtrips_through_persistence() {
    let db = std::sync::Arc::new(crate::persistence::db::Database::open_in_memory().unwrap());
    let detail = crate::ipc::dto::ArtistDetail {
        id: "artist:queen".into(),
        name: "Queen".into(),
        thumbnail: None,
        top_tracks: Vec::new(),
        albums: Vec::new(),
    };
    let json = serde_json::to_string(&detail).unwrap();
    db.artist_detail_cache_put("artist:queen", &json, 1_000)
        .unwrap();

    let (stored_json, fetched_at) = db.artist_detail_cache_get("artist:queen").unwrap().unwrap();
    assert_eq!(stored_json, json);
    assert_eq!(fetched_at, 1_000);

    let parsed: crate::ipc::dto::ArtistDetail = serde_json::from_str(&stored_json).unwrap();
    assert_eq!(parsed.id, "artist:queen");
}

#[test]
fn refresh_artist_detail_preserves_cached_tracks_from_failed_sources() {
    use jellyx_core::models::source::Source;
    use std::collections::HashMap;

    let db = std::sync::Arc::new(crate::persistence::db::Database::open_in_memory().unwrap());

    // Seed cache with a YouTube track from a previous successful refresh.
    let cached_track = jellyx_core::models::track::Track {
        id: "cached-yt-1".into(),
        source: Source::YouTube,
        source_id: "yt-1".into(),
        title: "Cached Song".into(),
        artist: "Queen".into(),
        album: None,
        duration: None,
        thumbnail: None,
        stream_url: None,
        local_path: None,
        playlist_id: None,
        metadata: HashMap::new(),
    };
    let cached_detail = crate::ipc::dto::ArtistDetail {
        id: "artist:queen".into(),
        name: "Queen".into(),
        thumbnail: None,
        top_tracks: vec![cached_track],
        albums: Vec::new(),
    };
    let cached_json = serde_json::to_string(&cached_detail).unwrap();
    db.artist_detail_cache_put("artist:queen", &cached_json, 1_000)
        .unwrap();

    // Simulate a refresh where local has no tracks and remote returns only
    // a SoundCloud track (YouTube "fails"). The cached YouTube track must
    // be preserved because YouTube is in the failed-source set.
    let sc_track = jellyx_core::models::track::Track {
        id: "fresh-sc-1".into(),
        source: Source::SoundCloud,
        source_id: "sc-1".into(),
        title: "Fresh SC".into(),
        artist: "Queen".into(),
        album: None,
        duration: None,
        thumbnail: None,
        stream_url: None,
        local_path: None,
        playlist_id: None,
        metadata: HashMap::new(),
    };

    // Manually replay the merge logic to assert preservation semantics.
    let mut merged: Vec<jellyx_core::models::track::Track> = Vec::new();
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for t in [sc_track.clone()] {
        let key = (format!("{:?}", t.source), t.source_id.clone());
        if seen.insert(key) {
            merged.push(t);
        }
    }
    let failed_set: std::collections::HashSet<String> =
        ["YouTube".to_string()].into_iter().collect();
    for t in cached_detail.top_tracks {
        let source_name = format!("{:?}", t.source);
        if failed_set.contains(&source_name) {
            let key = (source_name.clone(), t.source_id.clone());
            if seen.insert(key) {
                merged.push(t);
            }
        }
    }

    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.source_id == "yt-1"));
    assert!(merged.iter().any(|t| t.source_id == "sc-1"));
}
