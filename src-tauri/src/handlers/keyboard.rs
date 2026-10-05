use crate::commands::{get_selection, get_shortcut_context};
use crate::{REGISTERED_SHORTCUTS, SHORTCUT_PAUSED, SHORTCUT_SUSPEND};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

/// Handle keyboard shortcut event.
pub fn handle_keyboard_event(app: &AppHandle, hotkey: &Shortcut, event: ShortcutEvent) {
    // check if shortcut handling is suspended or paused
    if SHORTCUT_SUSPEND.load(Ordering::Relaxed) > 0 || SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return;
    }

    // Only key release triggers recognition; key presses need no context lookup.
    if event.state() != ShortcutState::Released {
        return;
    }

    // get shortcut string from registered shortcuts
    let shortcut = REGISTERED_SHORTCUTS
        .lock()
        .ok()
        .and_then(|r| r.get(&hotkey.id).cloned())
        .unwrap_or_else(|| "Unknown".to_string());

    let app_id = match get_shortcut_context(app, &shortcut) {
        Ok(context) if context.blocked => return,
        Ok(context) => context.app_id,
        Err(_) => String::new(),
    };

    // emit shortcut event with selection
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(selection) = get_selection(app_handle.clone(), Some(false)).await {
            let event_data = serde_json::json!({
                "shortcut": shortcut,
                "selection": selection,
                "appId": app_id
            });
            let _ = app_handle.emit("shortcut", event_data);
        }
    });
}
