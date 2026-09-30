use crate::commands::clipboard::{complete_clipboard_operation, ClipboardTransaction};
use crate::commands::keyboard::send_paste_keys;
use crate::commands::shortcut::ShortcutHandlerGuard;
use crate::error::AppError;
use crate::platform;
use crate::ENIGO;
use enigo::{Direction, Key, Keyboard};
use std::time::Duration;
use tauri::AppHandle;

/// Enter text and try to select it.
#[tauri::command]
pub async fn enter_text(
    app: AppHandle,
    text: String,
    clipboard: Option<bool>,
) -> Result<(), AppError> {
    if text.is_empty() {
        return Ok(());
    }
    // Cancellation while queued must not deliver an unwanted paste later.
    let mut clipboard = ClipboardTransaction::begin(!clipboard.unwrap_or(false)).await?;
    let chars = text.chars().count();
    clipboard.set_text(text)?;
    // Once mutated, let queued paste and target consumption finish if the caller goes away.
    complete_clipboard_operation(enter_text_inner(app, chars, clipboard)).await
}

async fn enter_text_inner(
    app: AppHandle,
    chars: usize,
    clipboard: ClipboardTransaction,
) -> Result<(), AppError> {
    // suspend shortcut handling to avoid interference
    let _guard = ShortcutHandlerGuard::suspend();

    let result = async {
        // send paste shortcut
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let check_input = clipboard.input_check();
        app.run_on_main_thread(move || {
            let _ =
                sender.send(check_input().and_then(|()| send_paste_keys(Some(false), Some(true))));
        })?;
        let pasted = receiver.await.map_err(|error| error.to_string());

        // Even a partially failed key sequence may have delivered paste to the target.
        tokio::time::sleep(Duration::from_millis(100)).await;
        pasted??;

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
                        #[cfg(target_os = "windows")]
                        std::thread::sleep(Duration::from_millis(5));

                        enigo.key(Key::LeftArrow, Direction::Click)?;
                    }
                    enigo.key(Key::Shift, Direction::Release)?;
                }
            }
        }

        Ok(())
    }
    .await;
    let restored = clipboard.finish();
    result.and(restored)
}
