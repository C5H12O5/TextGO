use crate::commands::clipboard::{clear_clipboard, get_clipboard_text, with_clipboard_backup};
use crate::commands::keyboard::send_copy_keys;
use crate::commands::shortcut::ShortcutHandlerGuard;
use crate::error::AppError;
use crate::platform;
use crate::{FORCE_GET_SELECTION, SELECTION_TEXT_CACHE};
use log::warn;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;

// maximum wait time in milliseconds for clipboard to update
static MAX_WAIT_TIME: AtomicU64 = AtomicU64::new(1000);

/// Get selected text.
#[tauri::command]
pub async fn get_selection(app: AppHandle, mouse: Option<bool>) -> Result<String, AppError> {
    // suspend shortcut handling to avoid interference
    let _guard = ShortcutHandlerGuard::suspend();

    // try using platform native API to get selected text first
    if let Ok(text) = platform::get_selection() {
        if !text.is_empty() {
            // clear cache to avoid stale data
            if let Ok(mut cache) = SELECTION_TEXT_CACHE.lock() {
                *cache = None;
            }

            return Ok(text);
        }
    }

    // if force get selection is disabled, skip clipboard fallback
    if !FORCE_GET_SELECTION.load(Ordering::Relaxed) {
        return Err("Native API failed and clipboard fallback is disabled".into());
    }

    // if native API fails, fall back to clipboard method
    warn!("Failed to get selection natively, fallback to clipboard method");
    get_selection_fallback(app, mouse.unwrap_or(false)).await
}

/// Get selected text through clipboard.
async fn get_selection_fallback(app: AppHandle, mouse: bool) -> Result<String, AppError> {
    if let Ok(mut cache) = SELECTION_TEXT_CACHE.lock() {
        *cache = None;
    }

    // use backup-operation-restore mode
    with_clipboard_backup(|| async move {
        // clear clipboard
        clear_clipboard()?;

        // send copy shortcut
        // https://github.com/enigo-rs/enigo/issues/153
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            // mouse-triggered selections don't need to release modifier keys
            let _ = sender.send(send_copy_keys(Some(false), Some(!mouse)));
        })?;
        receiver.await.map_err(|error| error.to_string())??;

        // wait for clipboard content to change in a loop
        let max_wait_time = Duration::from_millis(MAX_WAIT_TIME.load(Ordering::Relaxed));
        let selected_text = wait_for_copied_text(max_wait_time, get_clipboard_text).await;

        if selected_text.is_empty() {
            warn!(
                "Clipboard did not change within {} ms, possibly no text selected",
                max_wait_time.as_millis()
            );
        } else {
            // cache the selected text with current timestamp
            if let Ok(mut cache) = SELECTION_TEXT_CACHE.lock() {
                *cache = Some((selected_text.clone(), std::time::Instant::now()));
            }

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

/// Stop retrying after the deadline; a single native read can still block past it.
async fn wait_for_copied_text(
    timeout: Duration,
    mut read: impl FnMut() -> Result<String, AppError>,
) -> String {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
        if let Ok(text) = read() {
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

#[cfg(test)]
#[test]
fn slow_clipboard_reads_do_not_extend_the_retry_budget() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut reads = 0;
        let text = wait_for_copied_text(Duration::from_millis(10), || {
            reads += 1;
            std::thread::sleep(Duration::from_millis(20));
            Ok(String::new())
        })
        .await;
        assert!(text.is_empty());
        assert_eq!(reads, 1);
        assert_eq!(
            wait_for_copied_text(Duration::from_secs(1), || Ok("selected".into())).await,
            "selected"
        );
    });
}
