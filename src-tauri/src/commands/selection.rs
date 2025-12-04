use crate::commands::clipboard::{clear_clipboard, get_clipboard_text, with_clipboard_backup};
use crate::error::AppError;
use crate::platform;
use crate::ENIGO;
use enigo::{Direction, Key, Keyboard};
use log::warn;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;

/// Get selected text.
#[tauri::command]
pub async fn get_selection(app: AppHandle) -> Result<String, AppError> {
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
        let max_wait_time = Duration::from_millis(200); // max wait time 200ms
        let check_interval = Duration::from_millis(5); // check interval 5ms
        let max_attempts = max_wait_time.as_millis() / check_interval.as_millis();

        let mut selected_text = String::new();

        for _attempt in 0..max_attempts {
            sleep(check_interval).await;

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
        }

        Ok(selected_text)
    })
    .await
}

/// Send copy shortcut key.
fn send_copy_keys() -> Result<(), AppError> {
    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    // release modifier keys to avoid interference
    enigo.key(Key::Meta, Direction::Release)?;
    enigo.key(Key::Control, Direction::Release)?;
    enigo.key(Key::Alt, Direction::Release)?;
    enigo.key(Key::Shift, Direction::Release)?;

    // send Cmd+C or Ctrl+C
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press)?;
    enigo.key(Key::Unicode('c'), Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    Ok(())
}
