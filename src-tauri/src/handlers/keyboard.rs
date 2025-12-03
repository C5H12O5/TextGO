use crate::commands::get_selection;
use crate::{REGISTERED_SHORTCUTS, SHORTCUT_PAUSED};
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

/// Handle keyboard shortcut event.
pub fn handle_keyboard_event(app: &tauri::AppHandle, hotkey: &Shortcut, event: ShortcutEvent) {
    if event.state() == ShortcutState::Pressed {
        // check if shortcut processing is paused
        if let Ok(paused) = SHORTCUT_PAUSED.lock() {
            if *paused {
                return;
            }
        }

        // get shortcut string from registered shortcuts
        let shortcut = {
            let registered = REGISTERED_SHORTCUTS.lock().unwrap();
            registered
                .get(&hotkey.id)
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string())
        };

        // emit shortcut event with selection
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_handle.clone()).await {
                let event_data = serde_json::json!({
                    "shortcut": &shortcut,
                    "selection": selection
                });
                let _ = app_handle.emit("shortcut", event_data);
            }
        });
    }
}
