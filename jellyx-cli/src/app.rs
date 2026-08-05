//! Application state for the Jellyx TUI.
//!
//! Holds the engine services and current UI state. The engine owns all
//! business logic; this struct only tracks what the renderer needs.

use crossterm::event::KeyCode;
use jellyx_engine::library_service::LibraryService;
use jellyx_engine::local_track::LocalTrackRepository;
use jellyx_engine::preferences::PreferencesRepository;
use jellyx_engine::settings_service::SettingsService;
use jellyx_engine::sqlite::SqliteHandle;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Which tab/view is currently active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    Library,
    NowPlaying,
    Playlists,
    Focus,
    Settings,
}

impl View {
    pub fn label(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::NowPlaying => "Now Playing",
            Self::Playlists => "Playlists",
            Self::Focus => "Focus",
            Self::Settings => "Settings",
        }
    }

    pub fn all() -> [Self; 5] {
        [
            Self::Library,
            Self::NowPlaying,
            Self::Playlists,
            Self::Focus,
            Self::Settings,
        ]
    }

    pub fn next(self) -> Self {
        let all = Self::all();
        let idx = all.iter().position(|v| *v == self).unwrap_or(0);
        all[(idx + 1) % all.len()]
    }

    pub fn prev(self) -> Self {
        let all = Self::all();
        let idx = all.iter().position(|v| *v == self).unwrap_or(0);
        all[(idx + all.len() + 1) % all.len()]
    }
}

fn db_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("jellyx").join("jellyx.db"))
}

/// Top-level application state.
pub struct App {
    pub view: View,
    pub running: bool,
    pub message: String,
    pub db: Option<SqliteHandle>,
    pub library: Option<LibraryService>,
    pub settings: Option<SettingsService>,
    pub local_tracks: Vec<String>,
    pub source_settings: Vec<(String, bool)>,
    pub normalize_audio: bool,
    pub telemetry_enabled: bool,
}

impl App {
    pub fn new() -> Self {
        let mut app = Self {
            view: View::Library,
            running: true,
            message: "Welcome to Jellyx TUI — q to quit, Tab to switch".into(),
            db: None,
            library: None,
            settings: None,
            local_tracks: Vec::new(),
            source_settings: Vec::new(),
            normalize_audio: true,
            telemetry_enabled: false,
        };
        app.try_init_engine();
        app
    }

    fn try_init_engine(&mut self) {
        let path = match db_path() {
            Some(p) => p,
            None => {
                self.message = "Could not find data directory".into();
                return;
            }
        };

        if !path.exists() {
            self.message = format!("No DB at {}", path.display());
            return;
        }

        // Open with recovery — init closure runs schema + migrations.
        let init = |handle: &SqliteHandle| -> Result<(), String> {
            handle
                .initialize_schema()
                .map_err(|e| format!("schema init: {e}"))?;
            // Migrations are run by the desktop; the TUI just needs the
            // schema to be current. If the desktop has already migrated,
            // initialize_schema is idempotent.
            Ok(())
        };

        match SqliteHandle::open_with_recovery(&path, Duration::from_secs(5), init) {
            Ok(handle) => {
                self.library = Some(LibraryService::new(handle.clone()));
                self.settings = Some(SettingsService::new(Arc::new(handle.clone())));
                self.db = Some(handle);
                self.refresh_data();
                self.message = "Engine initialized — data loaded".into();
            }
            Err(e) => {
                self.message = format!("DB open failed: {e}");
            }
        }
    }

    pub fn refresh_data(&mut self) {
        if let Some(handle) = &self.db {
            let repo = LocalTrackRepository::new(handle.clone());
            if let Ok(rows) = repo.get_all(None) {
                self.local_tracks = rows
                    .into_iter()
                    .filter_map(|r| {
                        serde_json::from_str::<jellyx_core::models::track::Track>(&r.track_json)
                            .ok()
                            .map(|t| format!("{} — {}", t.artist, t.title))
                    })
                    .take(100)
                    .collect();
            }
        }

        if let Some(settings) = &self.settings {
            if let Ok(sources) = settings.get_source_settings() {
                self.source_settings = sources.into_iter().map(|s| (s.source, s.enabled)).collect();
            }
            if let Ok(audio) = settings.get_audio_settings() {
                self.normalize_audio = audio.normalize_audio;
            }
            if let Ok(telemetry) = settings.get_telemetry_settings() {
                self.telemetry_enabled = telemetry.enabled;
            }
        }
    }

    pub fn handle_key(&mut self, key: KeyCode) -> bool {
        match key {
            KeyCode::Char('q') | KeyCode::Esc => true,
            KeyCode::Tab => {
                self.view = self.view.next();
                self.message = format!("View: {}", self.view.label());
                false
            }
            KeyCode::BackTab => {
                self.view = self.view.prev();
                self.message = format!("View: {}", self.view.label());
                false
            }
            KeyCode::Char('r') => {
                self.refresh_data();
                self.message = "Data refreshed".into();
                false
            }
            _ => false,
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
