use crate::error::AppError;
use crate::{REGISTERED_SHORTCUTS, SHORTCUT_PAUSED, SHORTCUT_SUSPEND};
use std::sync::atomic::Ordering;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

// guard to suspend shortcut event handling within a scope
pub struct ShortcutHandlerGuard;

impl ShortcutHandlerGuard {
    pub fn suspend() -> Self {
        SHORTCUT_SUSPEND.store(true, Ordering::Relaxed);
        ShortcutHandlerGuard
    }
}

impl Drop for ShortcutHandlerGuard {
    fn drop(&mut self) {
        SHORTCUT_SUSPEND.store(false, Ordering::Relaxed);
    }
}

/// Pause shortcut event handling by unregistering all shortcuts.
#[tauri::command]
pub fn pause_shortcut_handling(app: AppHandle) -> Result<bool, AppError> {
    // check if already paused
    if SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // set paused flag to true
    SHORTCUT_PAUSED.store(true, Ordering::Relaxed);

    // unregister all shortcuts
    let shortcuts: Vec<String> = {
        let registered = REGISTERED_SHORTCUTS.lock()?;
        registered.values().cloned().collect()
    };

    for shortcut in shortcuts {
        let hotkey = parse_shortcut(&shortcut)?;
        app.global_shortcut().unregister(hotkey).ok();
    }

    Ok(true)
}

/// Resume shortcut event handling by re-registering all shortcuts.
#[tauri::command]
pub fn resume_shortcut_handling(app: AppHandle) -> Result<bool, AppError> {
    // check if already resumed
    if !SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return Ok(false);
    }

    // re-register all shortcuts
    let shortcuts: Vec<String> = {
        let registered = REGISTERED_SHORTCUTS.lock()?;
        registered.values().cloned().collect()
    };

    for shortcut in shortcuts {
        let hotkey = parse_shortcut(&shortcut)?;
        app.global_shortcut().register(hotkey).ok();
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
