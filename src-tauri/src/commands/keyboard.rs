use crate::commands::shortcut::ShortcutHandlerGuard;
use crate::error::AppError;
use crate::ENIGO;
use enigo::{Direction, Key, Keyboard};
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::AppHandle;

const SHORTCUT_RESUME_DELAY: Duration = Duration::from_millis(100);
#[cfg(target_os = "macos")]
const COMMAND_OR_CONTROL: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const COMMAND_OR_CONTROL: Key = Key::Control;

/// Send a keyboard key with optional modifiers.
#[tauri::command]
pub async fn send_key(
    app: AppHandle,
    key: String,
    modifiers: Option<Vec<String>>,
) -> Result<(), AppError> {
    let key = parse_key(&key)?;
    let mut modifier_keys = Vec::new();

    for modifier in modifiers.unwrap_or_default() {
        let modifier = parse_modifier(&modifier)?;
        if !modifier_keys.contains(&modifier) {
            modifier_keys.push(modifier);
        }
    }

    let _guard = ShortcutHandlerGuard::suspend();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), AppError> {
            let mut enigo_guard = ENIGO.lock()?;
            let enigo = enigo_guard.as_mut()?;

            // clear modifiers left over from the shortcut that triggered the script
            release_modifier_keys(enigo)?;

            // always attempt to release requested modifiers, even when sending the key fails
            let send_result = (|| -> Result<(), AppError> {
                for modifier in &modifier_keys {
                    enigo.key(*modifier, Direction::Press)?;
                }
                enigo.key(key, Direction::Click)?;
                Ok(())
            })();
            let release_result = release_keys(enigo, &modifier_keys);
            send_result.and(release_result)
        })();
        let _ = sender.send(result);
    })?;
    let result = receiver.recv()?;

    // Keep shortcut handling suspended until the synthetic release event is delivered.
    tokio::time::sleep(SHORTCUT_RESUME_DELAY).await;
    result
}

/// Send cut shortcut keys.
#[tauri::command]
pub fn send_cut_keys(
    suspend_shortcuts: Option<bool>,
    release_modifiers: Option<bool>,
) -> Result<(), AppError> {
    let _guard = if suspend_shortcuts.unwrap_or(false) {
        Some(ShortcutHandlerGuard::suspend())
    } else {
        None
    };

    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    if release_modifiers.unwrap_or(true) {
        release_modifier_keys(enigo)?;
    }

    // send Cmd+X or Ctrl+X
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press)?;
    enigo.key(Key::Unicode('x'), Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    Ok(())
}

/// Send copy shortcut keys.
#[tauri::command]
pub fn send_copy_keys(
    suspend_shortcuts: Option<bool>,
    release_modifiers: Option<bool>,
) -> Result<(), AppError> {
    let _guard = if suspend_shortcuts.unwrap_or(false) {
        Some(ShortcutHandlerGuard::suspend())
    } else {
        None
    };

    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    if release_modifiers.unwrap_or(true) {
        release_modifier_keys(enigo)?;
    }

    // send Cmd+C or Ctrl+Insert/Ctrl+C based on setting
    #[cfg(target_os = "macos")]
    let (modifier, key) = (Key::Meta, Key::Unicode('c'));
    #[cfg(not(target_os = "macos"))]
    let (modifier, key) = {
        if crate::USE_CTRL_C.load(Ordering::Relaxed) {
            (Key::Control, Key::Unicode('c'))
        } else {
            (Key::Control, Key::Insert)
        }
    };

    enigo.key(modifier, Direction::Press)?;
    enigo.key(key, Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    Ok(())
}

/// Send paste shortcut keys.
#[tauri::command]
pub fn send_paste_keys(
    suspend_shortcuts: Option<bool>,
    release_modifiers: Option<bool>,
) -> Result<(), AppError> {
    let _guard = if suspend_shortcuts.unwrap_or(false) {
        Some(ShortcutHandlerGuard::suspend())
    } else {
        None
    };

    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    if release_modifiers.unwrap_or(true) {
        release_modifier_keys(enigo)?;
    }

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

/// Release modifier keys to avoid interference.
fn release_modifier_keys(enigo: &mut dyn Keyboard) -> Result<(), AppError> {
    release_keys(enigo, &[Key::Meta, Key::Control, Key::Alt, Key::Shift])
}

/// Release all keys in reverse order and return the first error.
fn release_keys(enigo: &mut dyn Keyboard, keys: &[Key]) -> Result<(), AppError> {
    let mut first_error = None;

    for key in keys.iter().rev() {
        if let Err(error) = enigo.key(*key, Direction::Release) {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }

    match first_error {
        Some(error) => Err(error.into()),
        None => Ok(()),
    }
}

/// Parse a cross-platform modifier name.
fn parse_modifier(modifier: &str) -> Result<Key, AppError> {
    let alias = |modifier| match modifier {
        "meta" | "cmd" | "command" | "super" | "win" | "windows" => Some(Key::Meta),
        "control" | "ctrl" => Some(Key::Control),
        "alt" | "option" => Some(Key::Alt),
        "shift" => Some(Key::Shift),
        _ => None,
    };
    let normalized = modifier.trim().to_ascii_lowercase();

    if let Some((left, right)) = normalized.split_once("or") {
        if matches!(
            (alias(left), alias(right)),
            (Some(Key::Meta), Some(Key::Control)) | (Some(Key::Control), Some(Key::Meta))
        ) {
            return Ok(COMMAND_OR_CONTROL);
        }
    }

    alias(&normalized).ok_or_else(|| format!("Unsupported modifier key: {}", modifier).into())
}

/// Parse a character or a supported cross-platform key name.
fn parse_key(key: &str) -> Result<Key, AppError> {
    let mut characters = key.chars();
    if let (Some(character), None) = (characters.next(), characters.next()) {
        return Ok(Key::Unicode(character));
    }

    match key.trim().to_ascii_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "space" => Ok(Key::Space),
        "backspace" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "up" | "arrowup" => Ok(Key::UpArrow),
        "down" | "arrowdown" => Ok(Key::DownArrow),
        "left" | "arrowleft" => Ok(Key::LeftArrow),
        "right" | "arrowright" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" => Ok(Key::PageUp),
        "pagedown" => Ok(Key::PageDown),
        "f1" => Ok(Key::F1),
        "f2" => Ok(Key::F2),
        "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),
        "f5" => Ok(Key::F5),
        "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7),
        "f8" => Ok(Key::F8),
        "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10),
        "f11" => Ok(Key::F11),
        "f12" => Ok(Key::F12),
        "meta" | "cmd" | "command" | "super" | "win" | "windows" => Ok(Key::Meta),
        "control" | "ctrl" => Ok(Key::Control),
        "alt" | "option" => Ok(Key::Alt),
        "shift" => Ok(Key::Shift),
        _ => Err(format!("Unsupported key: {}", key).into()),
    }
}

#[cfg(test)]
#[test]
fn parses_supported_keys() {
    assert_eq!(parse_key("a").unwrap(), Key::Unicode('a'));
    assert_eq!(parse_key("Enter").unwrap(), Key::Return);
    assert_eq!(parse_key("ArrowLeft").unwrap(), Key::LeftArrow);
    assert_eq!(parse_key("F12").unwrap(), Key::F12);
    assert_eq!(parse_modifier("Command").unwrap(), Key::Meta);
    assert_eq!(parse_modifier("Ctrl").unwrap(), Key::Control);
    assert_eq!(parse_modifier("Option").unwrap(), Key::Alt);
    for modifier in ["CmdOrControl", "CommandOrCtrl", "ControlOrWindows"] {
        assert_eq!(parse_modifier(modifier).unwrap(), COMMAND_OR_CONTROL);
    }

    assert!(parse_key("UnknownKey").is_err());
    assert!(parse_modifier("Fn").is_err());
    assert!(parse_modifier("ShiftOrCtrl").is_err());
}
