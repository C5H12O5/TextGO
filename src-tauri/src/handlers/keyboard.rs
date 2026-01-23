use crate::commands::{get_selection, is_blocked};
use crate::{REGISTERED_SHORTCUTS, SHORTCUT_PAUSED, SHORTCUT_SUSPEND};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

/// Handle keyboard shortcut event.
pub fn handle_keyboard_event(app: &AppHandle, hotkey: &Shortcut, event: ShortcutEvent) {
    // check if shortcut handling is suspended or paused
    if SHORTCUT_SUSPEND.load(Ordering::Relaxed) || SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return;
    }

    // check if current frontmost application/website is in blacklist
    if let Ok(true) = is_blocked(app.clone()) {
        return;
    }

    // only handle key release events
    if event.state() == ShortcutState::Released {
        // get shortcut string from registered shortcuts
        let shortcut = REGISTERED_SHORTCUTS
            .lock()
            .ok()
            .and_then(|r| r.get(&hotkey.id).cloned())
            .unwrap_or_else(|| "Unknown".to_string());

        // emit shortcut event with selection
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_handle.clone()).await {
                let event_data = serde_json::json!({
                    "shortcut": shortcut,
                    "selection": selection
                });
                let _ = app_handle.emit("shortcut", event_data);
            }
        });
    }
}
