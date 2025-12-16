use crate::error::AppError;
use crate::CLIPBOARD;
use clipboard_rs::Clipboard;
use clipboard_rs::ContentFormat;

// all supported clipboard content formats
const ALL_FORMATS: [ContentFormat; 5] = [
    ContentFormat::Text,
    ContentFormat::Rtf,
    ContentFormat::Html,
    ContentFormat::Image,
    ContentFormat::Files,
];

/// Get clipboard text content.
#[tauri::command]
pub fn get_clipboard_text() -> Result<String, AppError> {
    run(|| match CLIPBOARD.lock()?.as_ref()?.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    })
}

/// Set clipboard text content.
#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<(), AppError> {
    run(|| Ok(CLIPBOARD.lock()?.as_ref()?.set_text(text)?))
}

/// Clear clipboard contents.
#[tauri::command]
pub fn clear_clipboard() -> Result<(), AppError> {
    run(|| Ok(CLIPBOARD.lock()?.as_ref()?.clear()?))
}

/// Backup clipboard contents, execute operation, then restore clipboard contents.
pub async fn with_clipboard_backup<F, Fut, T>(operation: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    // backup all format contents
    let contents = run(|| Ok(CLIPBOARD.lock()?.as_ref()?.get(&ALL_FORMATS)?))?;

    // execute operation
    let result = operation().await?;

    // restore original clipboard contents
    if !contents.is_empty() {
        run(|| Ok(CLIPBOARD.lock()?.as_ref()?.set(contents)?))?;
    } else {
        clear_clipboard()?;
    }

    Ok(result)
}

/// Run function on main thread if on macOS, otherwise run directly.
fn run<F, T>(func: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    #[cfg(target_os = "macos")]
    {
        use crate::APP_HANDLE;

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
