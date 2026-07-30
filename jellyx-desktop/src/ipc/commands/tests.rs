//! Tests for Tauri command handlers.
//!
//! These tests focus on pure, side-effect-free validation logic that does not
//! require a running Tauri runtime.

use super::*;

#[test]
fn source_contract_accepts_supported_source_names() {
    assert_eq!(
        parse_source("YouTube").unwrap(),
        jellyx_core::models::source::Source::YouTube
    );
    assert_eq!(
        parse_source("SoundCloud").unwrap(),
        jellyx_core::models::source::Source::SoundCloud
    );
    assert_eq!(
        parse_source("Local").unwrap(),
        jellyx_core::models::source::Source::Local
    );
}

#[test]
fn source_contract_rejects_unknown_names_instead_of_defaulting_to_youtube() {
    let error = parse_source("Unknown").unwrap_err();
    assert_eq!(error.code, "VALIDATION_ERROR");
    assert_eq!(
        error.details.as_deref(),
        Some("unsupported source: Unknown")
    );
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
    let url = "https://github.com/netcraker01/jellyx-player/issues/1";
    assert!(!is_release_url_allowed(url));
}
