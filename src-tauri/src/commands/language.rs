use crate::error::AppError;
use lingua::{LanguageDetector, LanguageDetectorBuilder};
use std::sync::OnceLock;

// Shared across requests and windows. Failed initialization does not poison OnceLock.
static DETECTOR: OnceLock<LanguageDetector> = OnceLock::new();

/// Detect the natural language of `text`, returning an ISO 639-1 code or `None` when unknown/blank.
/// Initialization and detection run on a blocking worker, never the UI/async executor thread.
/// Only Cargo-enabled languages are considered, in Lingua's default high-accuracy mode.
/// Worker failures (including initialization/detection panics) return an IPC error for the caller to handle.
#[tauri::command]
pub async fn detect_natural_language(text: String) -> Result<Option<String>, AppError> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let detector = DETECTOR.get_or_init(|| {
            LanguageDetectorBuilder::from_all_languages()
                .with_minimum_relative_distance(0.15)
                .build()
        });
        detector
            .detect_language_of(text)
            .map(|language| language.iso_code_639_1().to_string())
    })
    .await
    .map_err(|error| format!("Natural language detection failed: {error}").into())
}
