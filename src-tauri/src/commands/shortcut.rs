use crate::error::AppError;
use crate::REGISTERED_SHORTCUTS;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// Convert a Shortcut object back to a string representation
pub fn shortcut_to_string(shortcut: &Shortcut) -> String {
    let mut parts = Vec::new();

    // Parse the shortcut string representation
    // The format is like "Shortcut { mods: Some(CONTROL | SHIFT), key: KeyA }"
    let debug_str = format!("{:?}", shortcut);

    // Check for modifiers in the debug string
    if debug_str.contains("CONTROL") {
        parts.push("Ctrl".to_string());
    }
    if debug_str.contains("META") {
        parts.push("Command".to_string());
    }
    if debug_str.contains("ALT") {
        parts.push("Alt".to_string());
    }
    if debug_str.contains("SHIFT") {
        parts.push("Shift".to_string());
    }

    // Parse the key from the debug string
    let key_str = format!("{:?}", shortcut.key);
    let key = if key_str.starts_with("Key") {
        key_str.trim_start_matches("Key").to_string()
    } else if key_str.starts_with("Digit") {
        key_str.trim_start_matches("Digit").to_string()
    } else {
        key_str
    };

    parts.push(key);
    parts.join("+")
}

/// Parse a shortcut string and create a Shortcut object.
/// Supported formats:
/// - "Ctrl+A", "Command+A", "Alt+A", "Shift+A"
/// - "Ctrl+Shift+A", "Command+Alt+A", etc.
/// - Single key like "A", "1", etc.
fn parse_shortcut(shortcut_str: &str) -> Result<(Shortcut, String), AppError> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();

    if parts.is_empty() {
        return Err("Empty shortcut string".into());
    }

    let mut modifiers = Modifiers::empty();
    let key_part = parts.last().unwrap();

    // Parse modifiers
    for part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "cmd" | "command" | "meta" | "super" => modifiers |= Modifiers::META,
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            _ => return Err(format!("Unsupported modifier: {}", part).into()),
        }
    }

    // Parse key code - support various key types
    let key_upper = key_part.to_uppercase();
    let code_str = if key_upper.len() == 1 {
        let ch = key_upper.chars().next().unwrap();
        if ch.is_alphabetic() {
            format!("Key{}", ch)
        } else if ch.is_numeric() {
            format!("Digit{}", ch)
        } else {
            // Special single character keys
            match ch {
                '-' => "Minus".to_string(),
                '=' => "Equal".to_string(),
                '[' => "BracketLeft".to_string(),
                ']' => "BracketRight".to_string(),
                '\\' => "Backslash".to_string(),
                ';' => "Semicolon".to_string(),
                '\'' => "Quote".to_string(),
                ',' => "Comma".to_string(),
                '.' => "Period".to_string(),
                '/' => "Slash".to_string(),
                '`' => "Backquote".to_string(),
                ' ' => "Space".to_string(),
                _ => return Err(format!("Unsupported key: {}", key_part).into()),
            }
        }
    } else {
        // Multi-character special keys (normalized names)
        match key_upper.as_str() {
            // Function keys
            "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11"
            | "F12" => key_upper.clone(),
            // Arrow keys
            "ARROWUP" | "UP" => "ArrowUp".to_string(),
            "ARROWDOWN" | "DOWN" => "ArrowDown".to_string(),
            "ARROWLEFT" | "LEFT" => "ArrowLeft".to_string(),
            "ARROWRIGHT" | "RIGHT" => "ArrowRight".to_string(),
            // Special keys
            "ENTER" | "RETURN" => "Enter".to_string(),
            "TAB" => "Tab".to_string(),
            "BACKSPACE" => "Backspace".to_string(),
            "DELETE" | "DEL" => "Delete".to_string(),
            "SPACE" => "Space".to_string(),
            "ESCAPE" | "ESC" => "Escape".to_string(),
            "INSERT" | "INS" => "Insert".to_string(),
            "HOME" => "Home".to_string(),
            "END" => "End".to_string(),
            "PAGEUP" | "PGUP" => "PageUp".to_string(),
            "PAGEDOWN" | "PGDN" => "PageDown".to_string(),
            // Punctuation
            "MINUS" | "-" => "Minus".to_string(),
            "EQUAL" | "=" => "Equal".to_string(),
            "BRACKETLEFT" | "[" => "BracketLeft".to_string(),
            "BRACKETRIGHT" | "]" => "BracketRight".to_string(),
            "BACKSLASH" | "\\" => "Backslash".to_string(),
            "SEMICOLON" | ";" => "Semicolon".to_string(),
            "QUOTE" | "'" => "Quote".to_string(),
            "COMMA" | "," => "Comma".to_string(),
            "PERIOD" | "." => "Period".to_string(),
            "SLASH" | "/" => "Slash".to_string(),
            "BACKQUOTE" | "`" => "Backquote".to_string(),
            _ => key_upper.clone(),
        }
    };

    let code = code_str
        .parse::<Code>()
        .map_err(|_| format!("Unsupported key code: {}", code_str))?;
    let shortcut = Shortcut::new(Some(modifiers), code);

    Ok((shortcut, shortcut_str.to_string()))
}

/// Register global shortcut with custom modifier keys.
/// Accepts shortcut strings like "Ctrl+Shift+A", "Command+Alt+B", etc.
#[tauri::command]
pub fn register_shortcut(app: tauri::AppHandle, shortcut_str: String) -> Result<(), AppError> {
    // check if already registered
    {
        let registered = REGISTERED_SHORTCUTS.lock()?;
        if registered.contains_key(&shortcut_str) {
            return Err(format!("Shortcut {} is already registered", shortcut_str).into());
        }
    }

    // parse and create shortcut object
    let (shortcut, normalized_str) = parse_shortcut(&shortcut_str)?;

    // use plugin to register shortcut
    app.global_shortcut().register(shortcut)?;

    // save to registry (use the last part as the key identifier)
    let key_id = shortcut_str
        .split('+')
        .next_back()
        .unwrap_or(&shortcut_str)
        .to_uppercase();
    {
        let mut registered = REGISTERED_SHORTCUTS.lock()?;
        registered.insert(normalized_str, key_id);
    }

    Ok(())
}

/// Unregister global shortcut with custom modifier keys.
/// Accepts shortcut strings like "Ctrl+Shift+A", "Command+Alt+B", etc.
#[tauri::command]
pub fn unregister_shortcut(app: tauri::AppHandle, shortcut_str: String) -> Result<(), AppError> {
    // check if registered
    {
        let registered = REGISTERED_SHORTCUTS.lock()?;
        if !registered.contains_key(&shortcut_str) {
            return Err(format!("Shortcut {} is not registered", shortcut_str).into());
        }
    }

    // parse and create shortcut object
    let (shortcut, _) = parse_shortcut(&shortcut_str)?;

    // unregister shortcut
    app.global_shortcut().unregister(shortcut)?;

    // remove from registry
    {
        let mut registered = REGISTERED_SHORTCUTS.lock()?;
        registered.remove(&shortcut_str);
    }

    Ok(())
}

/// Check if global shortcut is registered.
/// Accepts shortcut strings like "Ctrl+Shift+A", "Command+Alt+B", etc.
#[tauri::command]
pub fn is_shortcut_registered(shortcut_str: String) -> Result<bool, AppError> {
    // check registration status
    let registered = REGISTERED_SHORTCUTS.lock()?;
    let is_registered = registered.contains_key(&shortcut_str);

    Ok(is_registered)
}
