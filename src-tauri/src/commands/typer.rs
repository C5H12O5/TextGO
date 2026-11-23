use crate::commands::clipboard::{set_clipboard_text, with_clipboard_backup};
use crate::commands::keyboard::send_paste_keys;
use crate::commands::shortcut::ShortcutHandlerGuard;
use crate::error::AppError;
use crate::input::lock_enigo;
use crate::platform::{self, PasteAnchor, PasteProgress};
use enigo::{Direction, Key, Keyboard};
use log::debug;
use std::time::Duration;
use tauri::AppHandle;

// delay for the target to process a paste when its selection cannot be inspected
const PASTE_SETTLE_DELAY: Duration = Duration::from_millis(100);

// maximum time to wait for the target to report the pasted text
const PASTE_CONFIRM_TIMEOUT: Duration = Duration::from_millis(1000);

// interval between paste confirmation checks
const PASTE_CONFIRM_INTERVAL: Duration = Duration::from_millis(20);

// maximum number of characters to select with simulated arrow keys
const MAX_KEYBOARD_SELECTION_CHARS: usize = 50;

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

    // suspend shortcut handling to avoid interference
    let _guard = ShortcutHandlerGuard::suspend();

    // core logic for entering text
    let do_enter_text = || async move {
        // capture the selection before the paste so its result can be recognized later
        let anchor = platform::get_paste_anchor().ok();

        // set clipboard text
        set_clipboard_text(text.clone())?;

        // send paste shortcut
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = sender.send(send_paste_keys(Some(false), Some(true)));
        })?;
        receiver.await.map_err(|error| error.to_string())??;

        match anchor {
            // select the entered text only after the target has applied the paste
            Some(anchor) => select_pasted_text(&anchor, &text).await,
            // allow the target to read the clipboard before it may be restored
            None => tokio::time::sleep(PASTE_SETTLE_DELAY).await,
        }

        Ok(())
    };

    // keep text in clipboard if clipboard is true, otherwise backup and restore
    if clipboard.unwrap_or(false) {
        do_enter_text().await
    } else {
        with_clipboard_backup(do_enter_text).await
    }
}

/// Wait for the target to report the paste, then select the inserted text.
///
/// Leave the selection unchanged if the paste cannot be confirmed in time, because moving it
/// before a delayed paste is applied would make the paste replace the wrong text.
async fn select_pasted_text(anchor: &PasteAnchor, text: &str) {
    let max_checks = PASTE_CONFIRM_TIMEOUT.as_millis() / PASTE_CONFIRM_INTERVAL.as_millis();
    for _ in 0..max_checks {
        tokio::time::sleep(PASTE_CONFIRM_INTERVAL).await;
        match platform::select_pasted_text(anchor, text) {
            Ok(PasteProgress::Selected) => return,
            Ok(PasteProgress::Unselectable) => {
                if let Err(error) = select_backward_with_keyboard(text.chars().count()) {
                    debug!("Failed to select pasted text with keyboard: {}", error);
                }
                return;
            }
            // the focused element can be briefly unavailable while the target re-renders
            Ok(PasteProgress::Pending) | Err(_) => (),
        }
    }
    debug!("Paste was not confirmed in time; leaving the selection unchanged");
}

/// Select characters before the caret with simulated Shift+Left key presses.
fn select_backward_with_keyboard(chars: usize) -> Result<(), AppError> {
    if chars > MAX_KEYBOARD_SELECTION_CHARS {
        return Ok(());
    }

    let mut enigo_guard = lock_enigo()?;
    let enigo = enigo_guard.as_mut()?;

    enigo.key(Key::Shift, Direction::Press)?;
    let result = (|| -> Result<(), AppError> {
        for _ in 0..chars {
            #[cfg(target_os = "windows")]
            std::thread::sleep(Duration::from_millis(5));

            enigo.key(Key::LeftArrow, Direction::Click)?;
        }
        Ok(())
    })();
    enigo.key(Key::Shift, Direction::Release)?;
    result
}
