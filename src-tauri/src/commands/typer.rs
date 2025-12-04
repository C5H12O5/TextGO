use crate::commands::clipboard::{set_clipboard_text, with_clipboard_backup};
use crate::error::AppError;
use crate::platform;
use crate::ENIGO;
use enigo::{Direction, Key, Keyboard};
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;

/// Enter text and try to select it.
#[tauri::command]
pub async fn enter_text(app: AppHandle, text: String) -> Result<(), AppError> {
    if text.is_empty() {
        return Ok(());
    }

    // calculate number of characters before moving text
    let chars = text.chars().count();

    // use clipboard to enter text
    with_clipboard_backup(|| async move {
        // set clipboard text
        set_clipboard_text(text)?;

        // send paste shortcut
        let _ = app.run_on_main_thread(|| {
            let _ = send_paste_keys();
        });

        // delay 100 ms to ensure paste operation completes
        sleep(Duration::from_millis(100)).await;

        // if cursor position is editable, try to select entered text
        if platform::is_cursor_editable()? {
            // first try using native API to select text
            if platform::select_backward_chars(chars).is_err() {
                // if native API call fails and char count is <= 50, use keyboard simulation
                if chars <= 50 {
                    let mut enigo_guard = ENIGO.lock()?;
                    let enigo = enigo_guard.as_mut()?;

                    enigo.key(Key::Shift, Direction::Press)?;
                    for _ in 0..chars {
                        enigo.key(Key::LeftArrow, Direction::Click)?;
                    }
                    enigo.key(Key::Shift, Direction::Release)?;
                }
            }
        }

        Ok(())
    })
    .await
}

/// Send paste shortcut key.
fn send_paste_keys() -> Result<(), AppError> {
    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    // release modifier keys to avoid interference
    enigo.key(Key::Meta, Direction::Release)?;
    enigo.key(Key::Control, Direction::Release)?;
    enigo.key(Key::Alt, Direction::Release)?;
    enigo.key(Key::Shift, Direction::Release)?;

    // send Cmd+V or Ctrl+V
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    Ok(())
}
