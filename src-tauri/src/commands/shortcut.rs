use super::identifier::{get_frontmost_context, FrontmostContext};
use crate::error::AppError;
use crate::{
    IBEAM_CURSOR, LONG_PRESS, LONG_PRESS_DURATION, MOUSE_CLICK_EPOCH, REGISTERED_SHORTCUTS,
    SETTINGS_STORE, SHORTCUT_PAUSED, SHORTCUT_SUSPEND, TOOLBAR_HIDE_ON_SCROLL,
    TRIPLE_CLICK_REGISTERED,
};
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_store::StoreExt;

/// Reuse the blacklist's application lookup when a shortcut uses a predicate.
/// Application identifiers are captured before fetching the selection asynchronously.
pub fn get_shortcut_context(app: &AppHandle, shortcut: &str) -> Result<FrontmostContext, AppError> {
    let store = app.store(SETTINGS_STORE)?;
    Ok(get_frontmost_context(store.get("blacklist"), || {
        shortcut_uses_predicate(
            store.get("shortcuts").as_ref(),
            store.get("predicates").as_ref(),
            shortcut,
        )
    }))
}

/// Only enabled shortcut groups referencing an existing, non-empty predicate need appId.
fn shortcut_uses_predicate(
    shortcuts: Option<&Value>,
    predicates: Option<&Value>,
    shortcut: &str,
) -> bool {
    let Some(group) = shortcuts.and_then(|value| value.get(shortcut)) else {
        return false;
    };
    if group.get("disabled").and_then(Value::as_bool) == Some(true) {
        return false;
    }
    let Some(rules) = group.get("rules").and_then(Value::as_array) else {
        return false;
    };
    let Some(predicates) = predicates.and_then(Value::as_array) else {
        return false;
    };

    rules.iter().any(|rule| {
        // Keep the prefix in sync with PREDICATE_MARK in constants.ts.
        let Some(id) = rule
            .get("case")
            .and_then(Value::as_str)
            .and_then(|case| case.strip_prefix("predicate-"))
        else {
            return false;
        };
        predicates
            .iter()
            .find(|predicate| predicate.get("id").and_then(Value::as_str) == Some(id))
            .and_then(|predicate| predicate.get("script").and_then(Value::as_str))
            .is_some_and(|code| !code.trim().is_empty())
    })
}

// guard to suspend shortcut event handling within a scope
pub struct ShortcutHandlerGuard;

impl ShortcutHandlerGuard {
    pub fn suspend() -> Self {
        let mut epoch = MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
        SHORTCUT_SUSPEND.fetch_add(1, Ordering::Relaxed);
        if TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed) {
            *epoch = epoch.wrapping_add(1);
        }
        ShortcutHandlerGuard
    }
}

impl Drop for ShortcutHandlerGuard {
    fn drop(&mut self) {
        let previous = SHORTCUT_SUSPEND.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(previous > 0, "shortcut suspension counter underflow");
    }
}

/// Pause shortcut event handling by unregistering all shortcuts.
#[tauri::command]
pub fn pause_shortcut_handling(
    app: AppHandle,
    unregister_all: Option<bool>,
) -> Result<bool, AppError> {
    // check if already paused
    if SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // set paused flag to true
    {
        let mut epoch = MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
        SHORTCUT_PAUSED.store(true, Ordering::Relaxed);
        if TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed) {
            *epoch = epoch.wrapping_add(1);
        }
    }

    // unregister all shortcuts
    if unregister_all.unwrap_or(false) {
        let shortcuts: Vec<String> = {
            let registered = REGISTERED_SHORTCUTS.lock()?;
            registered.values().cloned().collect()
        };

        for shortcut in shortcuts {
            let hotkey = parse_shortcut(&shortcut)?;
            app.global_shortcut().unregister(hotkey).ok();
        }
    }

    Ok(true)
}

/// Resume shortcut event handling by re-registering all shortcuts.
#[tauri::command]
pub fn resume_shortcut_handling(
    app: AppHandle,
    register_all: Option<bool>,
) -> Result<bool, AppError> {
    // check if already resumed
    if !SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // re-register all shortcuts
    if register_all.unwrap_or(false) {
        let shortcuts: Vec<String> = {
            let registered = REGISTERED_SHORTCUTS.lock()?;
            registered.values().cloned().collect()
        };

        for shortcut in shortcuts {
            let hotkey = parse_shortcut(&shortcut)?;
            app.global_shortcut().register(hotkey).ok();
        }
    }

    // set paused flag to false
    SHORTCUT_PAUSED.store(false, Ordering::Relaxed);

    Ok(true)
}

/// Register global shortcut.
#[tauri::command]
pub fn register_shortcut(app: AppHandle, shortcut: String) -> Result<(), AppError> {
    // check if registered
    if let Ok(registered) = is_shortcut_registered(shortcut.clone()) {
        if registered {
            return Err(format!("Shortcut {} is already registered", shortcut).into());
        }
    }

    // parse and create shortcut object
    let hotkey = parse_shortcut(&shortcut)?;

    // use plugin to register shortcut
    app.global_shortcut().register(hotkey)?;

    // save to registry
    {
        let mut registered = REGISTERED_SHORTCUTS.lock()?;
        registered.insert(hotkey.id, shortcut);
    }

    Ok(())
}

/// Unregister global shortcut.
#[tauri::command]
pub fn unregister_shortcut(app: AppHandle, shortcut: String) -> Result<(), AppError> {
    // check if registered
    if let Ok(registered) = is_shortcut_registered(shortcut.clone()) {
        if !registered {
            return Err(format!("Shortcut {} is not registered", shortcut).into());
        }
    }

    // parse and create shortcut object
    let hotkey = parse_shortcut(&shortcut)?;

    // unregister shortcut
    app.global_shortcut().unregister(hotkey)?;

    // remove from registry
    {
        let mut registered = REGISTERED_SHORTCUTS.lock()?;
        registered.remove(&hotkey.id);
    }

    Ok(())
}

/// Check if global shortcut is registered.
#[tauri::command]
pub fn is_shortcut_registered(shortcut: String) -> Result<bool, AppError> {
    // check registration status by checking values
    let registered = REGISTERED_SHORTCUTS.lock()?;
    let is_registered = registered.values().any(|v| v == &shortcut);
    Ok(is_registered)
}

/// Set the force get selection state (clipboard fallback).
#[tauri::command]
pub fn set_force_get_selection(enabled: bool) -> Result<(), AppError> {
    crate::FORCE_GET_SELECTION.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Set the copy key combination.
#[tauri::command]
pub fn set_copy_key(key: String) -> Result<(), AppError> {
    crate::USE_CTRL_C.store(key == "ctrl_c", Ordering::Relaxed);
    Ok(())
}

/// Set the long press enabled state.
#[tauri::command]
pub fn set_long_press_enabled(enabled: bool) -> Result<(), AppError> {
    LONG_PRESS.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Set the long press duration threshold.
#[tauri::command]
pub fn set_long_press_duration(duration: u64) -> Result<(), AppError> {
    LONG_PRESS_DURATION.store(duration, Ordering::Relaxed);
    Ok(())
}

/// Set the triple click registration state.
#[tauri::command]
pub fn set_triple_click_registered(registered: bool) -> Result<(), AppError> {
    let mut epoch = MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
    if TRIPLE_CLICK_REGISTERED.swap(registered, Ordering::Relaxed) != registered {
        *epoch = epoch.wrapping_add(1);
    }
    Ok(())
}

/// Set the I-beam cursor check state.
#[tauri::command]
pub fn set_ibeam_cursor_enabled(enabled: bool) -> Result<(), AppError> {
    IBEAM_CURSOR.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Set whether mouse wheel scrolling hides the toolbar.
#[tauri::command]
pub fn set_toolbar_hide_on_scroll(enabled: bool) -> Result<(), AppError> {
    TOOLBAR_HIDE_ON_SCROLL.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Parse a shortcut string and create a Shortcut object.
/// Supported formats:
/// - "Meta+A", "Control+A", "Alt+A", "Shift+A"
/// - "Control+Shift+A", "Meta+Alt+A", etc.
fn parse_shortcut(shortcut: &str) -> Result<Shortcut, AppError> {
    // split by '+'
    let keys: Vec<&str> = shortcut.split('+').collect();
    if keys.is_empty() {
        return Err("Empty shortcut string".into());
    }

    // parse modifiers
    let mut modifiers = Modifiers::empty();
    for modifier in &keys[..keys.len() - 1] {
        match modifier.to_lowercase().as_str() {
            "meta" => modifiers |= Modifiers::META,
            "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            _ => return Err(format!("Unsupported modifier: {}", modifier).into()),
        }
    }

    // parse key code
    let code_str = keys.last().ok_or("Missing key code")?;
    let code = code_str
        .parse::<Code>()
        .map_err(|_| format!("Unsupported key code: {}", code_str))?;

    Ok(Shortcut::new(Some(modifiers), code))
}

#[cfg(test)]
#[test]
fn suspension_guard_is_nest_safe() {
    let initial = SHORTCUT_SUSPEND.load(Ordering::Relaxed);
    let outer = ShortcutHandlerGuard::suspend();
    {
        let _inner = ShortcutHandlerGuard::suspend();
        assert_eq!(SHORTCUT_SUSPEND.load(Ordering::Relaxed), initial + 2);
    }
    assert_eq!(SHORTCUT_SUSPEND.load(Ordering::Relaxed), initial + 1);
    drop(outer);
    assert_eq!(SHORTCUT_SUSPEND.load(Ordering::Relaxed), initial);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn predicate_lookup_requires_an_enabled_current_rule_and_existing_predicate() {
        let predicates = json!([
            { "id": "valid", "script": "function matches(data) { return true; }" },
            { "id": "empty", "script": " \n\t" }
        ]);
        for (group, expected) in [
            (json!({ "rules": [{ "case": "predicate-valid" }] }), true),
            (json!({ "rules": [{ "case": "regexp-valid" }] }), false),
            (
                json!({ "rules": [{ "case": "", "action": "script-valid" }] }),
                false,
            ),
            (json!({ "rules": [{ "case": "predicate-deleted" }] }), false),
            (json!({ "rules": [{ "case": "predicate-empty" }] }), false),
            (
                json!({ "disabled": true, "rules": [{ "case": "predicate-valid" }] }),
                false,
            ),
            (json!({ "rules": [] }), false),
            (Value::Null, false),
        ] {
            let shortcuts = json!({
                "current": group,
                "other": { "rules": [{ "case": "predicate-valid" }] }
            });
            assert_eq!(
                shortcut_uses_predicate(Some(&shortcuts), Some(&predicates), "current"),
                expected,
                "{shortcuts}",
            );
            assert!(!shortcut_uses_predicate(
                Some(&shortcuts),
                Some(&predicates),
                "unregistered",
            ));
        }
    }

    #[test]
    fn predicate_lookup_tracks_deletion_and_rename_without_cached_registration() {
        let mut shortcuts = json!({ "current": { "rules": [{ "case": "predicate-old" }] } });
        let mut predicates =
            json!([{ "id": "old", "script": "function matches(data) { return true; }" }]);
        assert!(shortcut_uses_predicate(
            Some(&shortcuts),
            Some(&predicates),
            "current"
        ));
        predicates[0]["id"] = json!("new");
        assert!(!shortcut_uses_predicate(
            Some(&shortcuts),
            Some(&predicates),
            "current"
        ));
        shortcuts["current"]["rules"][0]["case"] = json!("predicate-new");
        assert!(shortcut_uses_predicate(
            Some(&shortcuts),
            Some(&predicates),
            "current"
        ));
        assert!(!shortcut_uses_predicate(
            Some(&shortcuts),
            Some(&json!([])),
            "current"
        ));
        assert!(!shortcut_uses_predicate(Some(&shortcuts), None, "current"));
        assert!(!shortcut_uses_predicate(None, Some(&predicates), "current"));
    }
}
