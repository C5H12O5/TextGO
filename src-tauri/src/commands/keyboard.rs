use crate::error::AppError;
use crate::ENIGO;
use enigo::{Direction, Key, Keyboard};

/// Send cut shortcut keys.
#[tauri::command]
pub fn send_cut_keys() -> Result<(), AppError> {
    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    release_modifier_keys(enigo)?;

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
pub fn send_copy_keys() -> Result<(), AppError> {
    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    release_modifier_keys(enigo)?;

    // send Cmd+C or Ctrl+C
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press)?;
    enigo.key(Key::Unicode('c'), Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    Ok(())
}

/// Send paste shortcut keys.
#[tauri::command]
pub fn send_paste_keys() -> Result<(), AppError> {
    let mut enigo_guard = ENIGO.lock()?;
    let enigo = enigo_guard.as_mut()?;

    release_modifier_keys(enigo)?;

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
    enigo.key(Key::Meta, Direction::Release)?;
    enigo.key(Key::Control, Direction::Release)?;
    enigo.key(Key::Alt, Direction::Release)?;
    enigo.key(Key::Shift, Direction::Release)?;
    Ok(())
}
