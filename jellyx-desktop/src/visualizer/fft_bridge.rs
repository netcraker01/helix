//! FFT IPC bridge — sends frequency data to the Svelte frontend via Tauri events.
//!
//! The FFT engine produces `FrequencyData` which is emitted as a Tauri event
//! (`"fft-frame"`) to the frontend. Events are fire-and-forget with no ordering
//! guarantees — if a frame is lost, the next one arrives normally. This avoids
//! the strict-index ordering of `Channel` IPC which could permanently stall
//! after a single delivery failure.
//!
//! The frontend listens via `listen("fft-frame", ...)` and converts the
//! JSON-serialized `FrequencyData` into a `Float32Array` for the visualizer.

use crate::audio::fft::FrequencyData;
use tauri::Emitter;

/// Event name emitted by the Rust FFT engine and listened by the JS frontend.
pub const FFT_FRAME_EVENT: &str = "fft-frame";

/// Emit a single FFT frame to all frontend listeners.
///
/// Uses `Webview::emit()` which serializes `FrequencyData` as JSON:
/// `{ "bins": [...], "sampleRate": 44100, "peak": 0.5 }`
///
/// The frontend receives this as a plain JS object, converts `bins` to
/// `Float32Array`, and feeds it to the visualizer.
///
/// Emit failures are non-fatal (frontend may not be listening).
pub fn emit_fft_frame<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    data: &FrequencyData,
) -> Result<(), tauri::Error> {
    app.emit(FFT_FRAME_EVENT, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::fft::FftEngine;
    use crate::audio::pipeline::PcmBus;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Listener;

    #[test]
    fn fft_frame_event_name_is_constant() {
        assert_eq!(FFT_FRAME_EVENT, "fft-frame");
    }

    #[test]
    fn fft_frame_wire_payload_matches_frontend_contract() {
        let data = FrequencyData {
            bins: vec![0.125, 0.25, 0.5],
            sample_rate: 48_000,
            peak: 0.5,
        };
        let payload = serde_json::to_value(&data).unwrap();

        assert_eq!(payload["bins"], serde_json::json!([0.125, 0.25, 0.5]));
        assert_eq!(payload["sampleRate"], 48_000);
        assert_eq!(payload["peak"], 0.5);
        assert!(payload.get("sample_rate").is_none());
    }

    #[test]
    fn consumed_pcm_reaches_tauri_listener_as_nonzero_fft_frame() {
        let app = tauri::test::mock_app();
        let (event_tx, event_rx) = mpsc::channel();
        app.listen(FFT_FRAME_EVENT, move |event| {
            event_tx.send(event.payload().to_owned()).unwrap();
        });

        let (tap, subscriber) = PcmBus::output_tap(2);
        let mut engine = FftEngine::new(1024, subscriber, 48_000, 2);
        let stereo: Vec<f32> = (0..1024)
            .flat_map(|frame| {
                let sample = (std::f32::consts::TAU * 16.0 * frame as f32 / 1024.0).sin();
                [sample, sample]
            })
            .collect();

        tap.send_consumed(&stereo);
        assert!(engine.collect_next_frame(Duration::from_millis(50)));
        let frame = engine.analyze_if_ready().unwrap();
        emit_fft_frame(app.handle(), &frame).unwrap();

        let payload = event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(payload["sampleRate"], 48_000);
        assert!(payload["peak"].as_f64().is_some_and(|peak| peak > 0.1));
    }
}
