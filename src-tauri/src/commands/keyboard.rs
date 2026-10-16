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

/// Map a character using the foreground application's current keyboard layout.
#[cfg(target_os = "windows")]
fn map_windows_character(character: char) -> Option<u16> {
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::{GetKeyboardLayout, VkKeyScanExW},
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };

    // VkKeyScanExW accepts one UTF-16 code unit. Preserve Enigo's Unicode fallback otherwise.
    let character = u16::try_from(u32::from(character)).ok()?;
    let mapping = unsafe {
        let thread_id = GetWindowThreadProcessId(GetForegroundWindow(), None);
        VkKeyScanExW(character, GetKeyboardLayout(thread_id))
    };
    (mapping != -1).then_some(mapping as u16)
}

/// Split Windows character mappings into a virtual key and required modifiers.
#[cfg(any(target_os = "windows", test))]
fn resolve_windows_key(
    key: Key,
    modifiers: &mut Vec<Key>,
    map_character: impl FnOnce(char) -> Option<u16>,
) -> Result<Key, AppError> {
    let character = match key {
        // Keep Enigo's special handling of these control characters.
        Key::Unicode('\n') => return Ok(Key::Return),
        Key::Unicode('\t') => return Ok(Key::Tab),
        Key::Unicode(character) => character.to_ascii_lowercase(),
        _ => return Ok(key),
    };

    // ASCII letters name keys case-insensitively; Shift remains an explicit modifier.
    let Some(mapping) = map_character(character) else {
        return Ok(Key::Unicode(character));
    };
    let virtual_key = mapping & 0xff;
    let shift_state = mapping >> 8;
    if !(1..=254).contains(&virtual_key) || shift_state & !0b111 != 0 {
        return Err("The keyboard layout requires an unsupported key or modifier state".into());
    }

    for (flag, modifier) in [(2, Key::Control), (4, Key::Alt), (1, Key::Shift)] {
        if shift_state & flag != 0 && !modifiers.contains(&modifier) {
            modifiers.push(modifier);
        }
    }

    // Key::Other accepts a virtual key on Windows and bypasses Enigo's broken Unicode mapping.
    Ok(Key::Other(u32::from(virtual_key)))
}

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

            #[cfg(target_os = "windows")]
            let key = resolve_windows_key(key, &mut modifier_keys, map_windows_character)?;

            // clear modifiers left over from the shortcut that triggered the script
            release_modifier_keys(enigo)?;
            send_key_combination(enigo, key, &modifier_keys)
        })();
        let _ = sender.send(result);
    })?;
    let result = receiver.recv()?;

    // keep shortcut handling suspended until the synthetic release event is delivered
    tokio::time::sleep(SHORTCUT_RESUME_DELAY).await;
    result
}

/// Send a key and release every explicit or inferred modifier even if an event fails.
fn send_key_combination(
    enigo: &mut dyn Keyboard,
    key: Key,
    modifiers: &[Key],
) -> Result<(), AppError> {
    let send_result = (|| -> Result<(), AppError> {
        for modifier in modifiers {
            enigo.key(*modifier, Direction::Press)?;
        }
        enigo.key(key, Direction::Click)?;
        Ok(())
    })();
    let release_result = release_keys(enigo, modifiers);
    send_result.and(release_result)
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
    enigo.key(Key::Unicode('v'), Direction::Press)?;
    // allow paste to arrive before keyup removes a rich-text editor's paste bin
    std::thread::sleep(Duration::from_millis(100));
    enigo.key(Key::Unicode('v'), Direction::Release)?;
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
fn preserves_characters_before_platform_mapping() {
    for character in ['W', 'w', 'É', '中', '🦀', '1', '!', '@', ' '] {
        assert_eq!(
            parse_key(&character.to_string()).unwrap(),
            Key::Unicode(character)
        );
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

#[cfg(test)]
mod windows_mapping_tests {
    use super::*;

    #[derive(Default)]
    struct RecordingKeyboard {
        events: Vec<(Key, Direction)>,
        fail_on: Option<(Key, Direction)>,
    }

    impl Keyboard for RecordingKeyboard {
        fn fast_text(&mut self, _: &str) -> enigo::InputResult<Option<()>> {
            panic!("keyboard shortcuts must send keys, not text");
        }

        fn key(&mut self, key: Key, direction: Direction) -> enigo::InputResult<()> {
            self.events.push((key, direction));
            if self.fail_on == Some((key, direction)) {
                Err(enigo::InputError::Simulate("test input failure"))
            } else {
                Ok(())
            }
        }

        fn raw(&mut self, _: u16, _: Direction) -> enigo::InputResult<()> {
            panic!("expected virtual keys, not scan codes");
        }
    }

    #[test]
    fn maps_shifted_symbols_using_layout_keycodes() {
        // VkKeyScanExW fixtures: US !/@/+ and UK @ (Shift + quote).
        for (character, mapping, virtual_key) in [
            ('!', 0x0131, 0x31),
            ('@', 0x0132, 0x32),
            ('+', 0x01bb, 0xbb),
            ('@', 0x01de, 0xde),
        ] {
            let mut modifiers = vec![];
            let key = resolve_windows_key(Key::Unicode(character), &mut modifiers, |input| {
                assert_eq!(input, character);
                Some(mapping)
            })
            .unwrap();
            assert_eq!(key, Key::Other(virtual_key));
            assert_eq!(modifiers, [Key::Shift]);
        }
    }

    #[test]
    fn keeps_ascii_letter_shortcuts_case_insensitive() {
        for (uppercase, lowercase, mapping) in
            [('A', 'a', 0x0041), ('W', 'w', 0x0057), ('Z', 'z', 0x005a)]
        {
            for character in [uppercase, lowercase] {
                let mut modifiers = vec![Key::Alt];
                let key = resolve_windows_key(Key::Unicode(character), &mut modifiers, |input| {
                    assert_eq!(input, lowercase);
                    Some(mapping)
                })
                .unwrap();
                assert_eq!(key, Key::Other(u32::from(mapping)));
                assert_eq!(modifiers, [Key::Alt]);
            }
        }
    }

    #[test]
    fn merges_required_modifiers_without_duplicates() {
        for (character, mapping, explicit, expected) in [
            (
                '!',
                0x0131,
                vec![Key::Alt, Key::Shift],
                vec![Key::Alt, Key::Shift],
            ),
            (
                '@',
                0x0651,
                vec![Key::Control],
                vec![Key::Control, Key::Alt],
            ),
            ('€', 0x0645, vec![], vec![Key::Control, Key::Alt]),
            ('W', 0x0057, vec![Key::Shift], vec![Key::Shift]),
        ] {
            let mut modifiers = explicit;
            resolve_windows_key(Key::Unicode(character), &mut modifiers, |_| Some(mapping))
                .unwrap();
            assert_eq!(modifiers, expected);
        }
    }

    #[test]
    fn preserves_named_keys_and_control_characters() {
        for (key, expected) in [
            (Key::Return, Key::Return),
            (Key::F12, Key::F12),
            (Key::LeftArrow, Key::LeftArrow),
            (Key::Unicode('\n'), Key::Return),
            (Key::Unicode('\t'), Key::Tab),
        ] {
            let mut modifiers = vec![Key::Control];
            assert_eq!(
                resolve_windows_key(key, &mut modifiers, |_| panic!("not a character lookup"))
                    .unwrap(),
                expected
            );
            assert_eq!(modifiers, [Key::Control]);
        }
    }

    #[test]
    fn preserves_unicode_fallback_for_unmapped_characters() {
        for character in ['中', '🦀', 'É'] {
            let mut modifiers = vec![];
            assert_eq!(
                resolve_windows_key(Key::Unicode(character), &mut modifiers, |_| None).unwrap(),
                Key::Unicode(character)
            );
            assert!(modifiers.is_empty());
        }
    }

    #[test]
    fn rejects_unrepresentable_mappings_before_changing_modifiers() {
        // Invalid virtual keys and Hankaku/driver-specific shift states must not be injected.
        for mapping in [0x0100, 0x01ff, 0x0831, 0x1031, 0x2031] {
            let mut modifiers = vec![Key::Alt];
            assert!(
                resolve_windows_key(Key::Unicode('!'), &mut modifiers, |_| Some(mapping)).is_err()
            );
            assert_eq!(modifiers, [Key::Alt]);
        }
    }

    #[test]
    fn sends_and_releases_explicit_and_inferred_modifiers() {
        let mut modifiers = vec![Key::Alt];
        let key = resolve_windows_key(Key::Unicode('!'), &mut modifiers, |_| Some(0x0131)).unwrap();
        let mut keyboard = RecordingKeyboard::default();
        send_key_combination(&mut keyboard, key, &modifiers).unwrap();
        assert_eq!(
            keyboard.events,
            [
                (Key::Alt, Direction::Press),
                (Key::Shift, Direction::Press),
                (Key::Other(0x31), Direction::Click),
                (Key::Shift, Direction::Release),
                (Key::Alt, Direction::Release),
            ]
        );
    }

    #[test]
    fn releases_inferred_modifiers_after_press_click_or_release_failures() {
        for failed_event in [
            (Key::Alt, Direction::Press),
            (Key::Other(0x51), Direction::Click),
            (Key::Alt, Direction::Release),
        ] {
            let mut modifiers = vec![];
            let key =
                resolve_windows_key(Key::Unicode('@'), &mut modifiers, |_| Some(0x0651)).unwrap();
            let mut keyboard = RecordingKeyboard {
                fail_on: Some(failed_event),
                ..Default::default()
            };
            assert!(send_key_combination(&mut keyboard, key, &modifiers).is_err());
            assert!(keyboard.events.ends_with(&[
                (Key::Alt, Direction::Release),
                (Key::Control, Direction::Release),
            ]));
            assert_eq!(
                keyboard
                    .events
                    .contains(&(Key::Other(0x51), Direction::Click)),
                failed_event != (Key::Alt, Direction::Press)
            );
        }
    }
}
