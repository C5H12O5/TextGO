use crate::commands::clipboard::{clear_clipboard, get_clipboard_text, with_clipboard_backup};
use crate::commands::keyboard::send_copy_keys;
use crate::commands::shortcut::ShortcutHandlerGuard;
use crate::error::AppError;
use crate::platform;
use log::warn;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;

// maximum wait time in milliseconds for clipboard to update
static MAX_WAIT_TIME: AtomicU64 = AtomicU64::new(1000);

/// Get selected text.
#[tauri::command]
pub async fn get_selection(app: AppHandle) -> Result<String, AppError> {
    // suspend shortcut handling to avoid interference
    let _guard = ShortcutHandlerGuard::suspend();

    // try using platform native API to get selected text first
    if let Ok(text) = platform::get_selection() {
        if !text.is_empty() {
            return Ok(text);
        }
    }

    // if native API fails, fall back to clipboard method
    warn!("Failed to get selection natively, fallback to clipboard method");
    get_selection_fallback(app).await
}

/// Get selected text through clipboard.
async fn get_selection_fallback(app: AppHandle) -> Result<String, AppError> {
    // use backup-operation-restore mode
    with_clipboard_backup(|| async move {
        // clear clipboard
        clear_clipboard()?;

        // send copy shortcut
        // https://github.com/enigo-rs/enigo/issues/153
        let _ = app.run_on_main_thread(|| {
            let _ = send_copy_keys();
        });

        // wait for clipboard content to change in a loop
        let max_wait_time = Duration::from_millis(MAX_WAIT_TIME.load(Ordering::Relaxed));
        let check_interval = Duration::from_millis(5); // check interval 5ms
        let max_attempts = max_wait_time.as_millis() / check_interval.as_millis();

        let mut selected_text = String::new();

        for _attempt in 0..max_attempts {
            tokio::time::sleep(check_interval).await;

            // read current clipboard text
            if let Ok(current_text) = get_clipboard_text() {
                if !current_text.is_empty() {
                    // if clipboard content changed, copy operation completed
                    selected_text = current_text;
                    break;
                }
            }
        }

        if selected_text.is_empty() {
            warn!(
                "Clipboard did not change within {} ms, possibly no text selected",
                max_wait_time.as_millis()
            );
        } else {
            // adjust max wait time for next time
            MAX_WAIT_TIME
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                    if current > 200 {
                        Some((current - 100).max(200))
                    } else {
                        Some(current)
                    }
                })
                .ok();
        }

        Ok(selected_text)
    })
    .await
}
