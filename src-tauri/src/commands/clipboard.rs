use crate::error::AppError;
use crate::{APP_HANDLE, CLIPBOARD_CONTEXT};
use clipboard_rs::Clipboard;
use clipboard_rs::ContentFormat;
use log::warn;

/// Get clipboard text content.
#[tauri::command]
pub fn get_clipboard_text() -> Result<String, AppError> {
    run(|| Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.get_text()?))
}

/// Run function on main thread if on macOS, otherwise run directly.
fn run<F, T>(func: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();

        if let Some(app) = APP_HANDLE.lock()?.clone() {
            app.run_on_main_thread(move || {
                let _ = tx.send(func());
            })?;
        }

        rx.recv()?
    }

    #[cfg(not(target_os = "macos"))]
    {
        func()
    }
}

/// Backup clipboard contents, execute operation, then restore clipboard contents.
pub async fn with_clipboard_backup<F, Fut, T>(operation: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    // backup all format contents
    let formats = [
        ContentFormat::Text,
        ContentFormat::Rtf,
        ContentFormat::Html,
        ContentFormat::Image,
        ContentFormat::Files,
    ];

    let contents = {
        let clipboard = CLIPBOARD_CONTEXT.lock()?;
        let clipboard_ref = clipboard
            .as_ref()
            .map_err(|e| format!("Failed to get clipboard context: {}", e))?;
        clipboard_ref.get(&formats).unwrap_or_default()
    }; // lock is dropped here

    // execute operation
    let result = operation().await?;

    // restore original clipboard contents
    if !contents.is_empty() {
        let clipboard = CLIPBOARD_CONTEXT.lock()?;
        if let Ok(clipboard_ref) = clipboard.as_ref() {
            if let Err(e) = clipboard_ref.set(contents) {
                warn!("Failed to restore clipboard contents: {}", e);
            }
        }
    } // lock is dropped here

    Ok(result)
}
