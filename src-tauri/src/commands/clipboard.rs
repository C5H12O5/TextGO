use crate::error::AppError;
use crate::{APP_HANDLE, CLIPBOARD_CONTEXT};
use clipboard_rs::ContentFormat;
use clipboard_rs::{Clipboard, ClipboardContent};

/// Get clipboard text content.
#[tauri::command]
pub fn get_clipboard_text() -> Result<String, AppError> {
    run(|| Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.get_text()?))
}

/// Set clipboard text content.
#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<(), AppError> {
    run(|| Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.set_text(text)?))
}

/// Clear clipboard contents.
#[tauri::command]
pub fn clear_clipboard() -> Result<(), AppError> {
    run(|| Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.clear()?))
}

/// Backup clipboard contents, execute operation, then restore clipboard contents.
pub async fn with_clipboard_backup<F, Fut, T>(operation: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    // backup all format contents
    let contents = get_all()?;

    // execute operation
    let result = operation().await?;

    // restore original clipboard contents
    set_all(contents)?;

    Ok(result)
}

/// Get all clipboard content formats.
fn get_all() -> Result<Vec<ClipboardContent>, AppError> {
    run(|| {
        let formats = [
            ContentFormat::Text,
            ContentFormat::Rtf,
            ContentFormat::Html,
            ContentFormat::Image,
            ContentFormat::Files,
        ];
        Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.get(&formats)?)
    })
}

/// Set clipboard contents with multiple formats.
fn set_all(contents: Vec<ClipboardContent>) -> Result<(), AppError> {
    run(|| {
        if !contents.is_empty() {
            return Ok(CLIPBOARD_CONTEXT.lock()?.as_ref()?.set(contents)?);
        }
        Ok(())
    })
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
