use crate::commands::{
    get_clipboard_text, get_selection, is_blocked, send_copy_keys, set_clipboard_text,
    ShortcutHandlerGuard,
};
use crate::error::AppError;
use crate::platform;
use crate::{
    APP_HANDLE, CLIPBOARD_RESTORE_INTERRUPTED, ENIGO, IBEAM_CURSOR, LONG_PRESS,
    LONG_PRESS_DURATION, MOUSE_CLICK_EPOCH, SELECTION_TEXT_CACHE, SHORTCUT_PAUSED,
    SHORTCUT_SUSPEND, SIMULATED_INPUT_MARKER, TOOLBAR_HIDE_ON_SCROLL, TOOLBAR_MENU_OPEN,
    TRIPLE_CLICK_REGISTERED,
};
use enigo::{Direction, Key as EnigoKey, Keyboard, Mouse};
use log::debug;
use rdev::{Button, Event, EventType, Key};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
const WINDOWS_KEY_C: u32 = 0x43;
#[cfg(target_os = "windows")]
const WINDOWS_LEFT_CONTROL: i32 = 0xA2;
#[cfg(target_os = "windows")]
const WINDOWS_RIGHT_CONTROL: i32 = 0xA3;

#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
    unsafe fn GetAsyncKeyState(vkey: i32) -> i16;
}

#[cfg(target_os = "windows")]
fn windows_control_key_pressed() -> bool {
    let left_control_state = unsafe { GetAsyncKeyState(WINDOWS_LEFT_CONTROL) } as u16;
    let right_control_state = unsafe { GetAsyncKeyState(WINDOWS_RIGHT_CONTROL) } as u16;

    left_control_state & 0x8000 != 0 || right_control_state & 0x8000 != 0
}

#[cfg(target_os = "macos")]
const MACOS_KEY_C: u32 = 8;
#[cfg(target_os = "macos")]
const MACOS_LEFT_COMMAND: u32 = 55;
#[cfg(target_os = "macos")]
const MACOS_RIGHT_COMMAND: u32 = 54;
#[cfg(target_os = "macos")]
const CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: i32 = 1;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    unsafe fn CGEventSourceKeyState(state_id: i32, key: u16) -> bool;
}

#[cfg(target_os = "macos")]
fn macos_command_key_pressed() -> bool {
    let left_command_pressed = unsafe {
        CGEventSourceKeyState(
            CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE,
            MACOS_LEFT_COMMAND as u16,
        )
    };
    let right_command_pressed = unsafe {
        CGEventSourceKeyState(
            CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE,
            MACOS_RIGHT_COMMAND as u16,
        )
    };

    left_command_pressed || right_command_pressed
}

/// Mouse click data.
#[derive(Clone, Copy)]
struct Click {
    time: Instant,
    pos: (f64, f64),
    valid_cursor: bool,
    count: u8,
    third_pressed: bool,
    epoch: u64,
}

// long press tracking states
static LONG_PRESS_EPOCH: AtomicU64 = AtomicU64::new(0);
static LONG_PRESS_TRIGGERED: AtomicBool = AtomicBool::new(false);

// mouse event tracking states
thread_local! {
    static DRAG_START_POS: Cell<Option<(f64, f64)>> = const { Cell::new(None) };
    static LAST_CLICK: Cell<Option<Click>> = const { Cell::new(None) };
    static IS_DRAGGING: Cell<bool> = const { Cell::new(false) };
    static IS_VALID_CURSOR: Cell<bool> = const { Cell::new(false) };
    static SHIFT_PRESSED: Cell<bool> = const { Cell::new(false) };
    static COPY_MODIFIER_PRESSED: Cell<bool> = const { Cell::new(false) };
}

// thresholds for drag and consecutive click detection
const MIN_DRAG_DISTANCE: f64 = 8.0;
const MAX_DBCLICK_DISTANCE: f64 = 3.0;
const MAX_DBCLICK_INTERVAL: Duration = Duration::from_millis(500);
const DBCLICK_SHORTCUT: &str = "MouseClick+MouseClick";
const TRIPLE_CLICK_SHORTCUT: &str = "MouseClick+MouseClick+MouseClick";

/// Handle mouse event.
pub fn handle_mouse_event(event: Event) {
    // check if shortcut handling is suspended or paused
    if SHORTCUT_SUSPEND.load(Ordering::Relaxed) > 0 || SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        if TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed) {
            cancel_pending_click(true);
        }
        return;
    }
    detect_user_copy_operation(&event);

    if TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed) {
        match event.event_type {
            EventType::KeyPress(_) | EventType::Wheel { .. } => cancel_pending_click(true),
            EventType::ButtonPress(button) if button != Button::Left => {
                cancel_pending_click(true);
            }
            _ => (),
        }
    }

    match event.event_type {
        EventType::ButtonPress(Button::Left) => {
            let _ = handle_mouse_press();
        }
        EventType::MouseMove { x, y } => {
            let _ = handle_mouse_move(x, y);
        }
        EventType::ButtonRelease(Button::Left) => {
            let _ = handle_mouse_release();
        }
        EventType::KeyPress(key) => {
            // track shift key state
            if matches!(key, Key::ShiftLeft | Key::ShiftRight) {
                #[cfg(target_os = "windows")]
                if SHIFT_PRESSED.get() {
                    // ignore repeated key press on Windows
                    return;
                }

                SHIFT_PRESSED.set(true);
            }

            // close native action menu on key press
            if matches!(close_native_menu(key, event.platform_code), Ok(true)) {
                return;
            }

            // hide toolbar on key press
            let _ = hide_toolbar(false);
        }
        EventType::KeyRelease(Key::ShiftLeft) | EventType::KeyRelease(Key::ShiftRight) => {
            SHIFT_PRESSED.set(false);
        }
        EventType::Wheel { .. } if TOOLBAR_HIDE_ON_SCROLL.load(Ordering::Relaxed) => {
            // hide toolbar on wheel scroll
            let _ = hide_toolbar(false);
        }
        _ => (),
    }
}

/// Detect user copy operation while shortcut handling is active.
fn detect_user_copy_operation(event: &Event) {
    // Our copy events can arrive after the selection's suspension guard has been dropped.
    if event.extra_data as u64 == u64::from(SIMULATED_INPUT_MARKER) {
        return;
    }

    match event.event_type {
        EventType::KeyPress(key) => {
            update_copy_modifier_state(key, true);

            if matches!(key, Key::KeyC) && COPY_MODIFIER_PRESSED.get() {
                CLIPBOARD_RESTORE_INTERRUPTED.store(true, Ordering::Relaxed);
                debug!("Copy shortcut detected, marking clipboard restore as interrupted");

                let cached_text = SELECTION_TEXT_CACHE.lock().ok().and_then(|cache| {
                    cache.as_ref().and_then(|(text, cached_at)| {
                        if cached_at.elapsed() < Duration::from_secs(1) {
                            Some(text.clone())
                        } else {
                            None
                        }
                    })
                });
                if let Some(cached_text) = cached_text {
                    tauri::async_runtime::spawn(async move {
                        // wait briefly for OS to finish processing the copy shortcut
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        // check if clipboard content matches cached selection
                        if let Ok(current) = get_clipboard_text() {
                            if current.trim() != cached_text.trim() {
                                // clipboard was overwritten by restore before interrupt fired
                                // compensate by writing the cached selection back
                                debug!(
                                    "Copy shortcut compensation: restoring cached selection to clipboard"
                                );
                                let _ = set_clipboard_text(cached_text);
                            }
                        }
                    });
                }
            }
        }
        EventType::KeyRelease(key) => {
            update_copy_modifier_state(key, false);
        }
        _ => (),
    }
}

/// Update platform copy modifier state (Ctrl on Windows, Command on macOS).
fn update_copy_modifier_state(key: Key, pressed: bool) {
    #[cfg(target_os = "windows")]
    if matches!(key, Key::ControlLeft | Key::ControlRight) {
        COPY_MODIFIER_PRESSED.set(pressed);
    }

    #[cfg(target_os = "macos")]
    if matches!(key, Key::MetaLeft | Key::MetaRight) {
        COPY_MODIFIER_PRESSED.set(pressed);
    }
}

/// Handle mouse press event (detect drag start).
fn handle_mouse_press() -> Result<(), AppError> {
    // cancel pending double click before fetching selection
    // preserve the click sequence for triple click detection
    cancel_pending_click(false);
    let pressed_at = Instant::now();

    // start tracking potential drag
    let pos = mouse_pos()?;
    record_third_press(pressed_at, pos);
    DRAG_START_POS.set(Some(pos));
    IS_DRAGGING.set(false);

    // record if cursor is I-Beam
    let is_valid_cursor = is_ibeam_cursor();
    IS_VALID_CURSOR.set(is_valid_cursor);

    // reset long press trigger state
    LONG_PRESS_TRIGGERED.store(false, Ordering::Relaxed);

    // start long press detection if enabled
    if is_valid_cursor && LONG_PRESS.load(Ordering::Relaxed) {
        let duration = LONG_PRESS_DURATION.load(Ordering::Relaxed);
        let epoch = LONG_PRESS_EPOCH
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);

        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(duration)).await;

            // check if long press is still valid
            if LONG_PRESS_EPOCH.load(Ordering::Relaxed) == epoch {
                debug!("Long press triggered after {}ms", duration);
                LONG_PRESS_TRIGGERED.store(true, Ordering::Relaxed);
                let _ = emit_event("LongPress", None, None);
            }
        });
    }

    // hide toolbar on mouse press
    hide_toolbar(true)?;

    Ok(())
}

/// Handle mouse move event (detect dragging).
fn handle_mouse_move(x: f64, y: f64) -> Result<(), AppError> {
    if let Some((start_x, start_y)) = DRAG_START_POS.get() {
        // check if moved enough to be considered a drag
        if distance((x, y), (start_x, start_y)) >= MIN_DRAG_DISTANCE {
            IS_DRAGGING.set(true);
            // invalidate long press if dragging starts
            LONG_PRESS_EPOCH.fetch_add(1, Ordering::Relaxed);
        }
    }

    Ok(())
}

/// Handle mouse release event (detect drag end, double click or triple click).
fn handle_mouse_release() -> Result<(), AppError> {
    // invalidate long press if mouse is released
    LONG_PRESS_EPOCH.fetch_add(1, Ordering::Relaxed);

    // reset drag start position
    DRAG_START_POS.set(None);

    let triple_click_registered = TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed);
    if triple_click_registered
        && (LONG_PRESS_TRIGGERED.load(Ordering::Relaxed)
            || IS_DRAGGING.get()
            || SHIFT_PRESSED.get())
    {
        cancel_pending_click(true);
    }

    // skip other events if long press was triggered
    if LONG_PRESS_TRIGGERED.load(Ordering::Relaxed) {
        LONG_PRESS_TRIGGERED.store(false, Ordering::Relaxed);
        IS_DRAGGING.set(false);
        return Ok(());
    }

    // only process text selection if cursor was valid
    // inspired by https://github.com/0xfullex/selection-hook
    let is_valid_cursor = IS_VALID_CURSOR.get() || is_ibeam_cursor();

    // check for drag end
    if IS_DRAGGING.get() {
        debug!("Checking for drag end (cursor: {})", is_valid_cursor);
        if is_valid_cursor {
            // emit drag end event
            emit_event("MouseClick+MouseMove", None, None)?;
        }
        IS_DRAGGING.set(false);
        return Ok(());
    }

    // check for shift+click
    if SHIFT_PRESSED.get() {
        debug!("Checking for shift+click (cursor: {})", is_valid_cursor);
        if is_valid_cursor {
            // emit shift+click event
            emit_event("Shift+MouseClick", None, None)?;
        }

        // avoid sticky shift state on macOS
        #[cfg(target_os = "macos")]
        SHIFT_PRESSED.set(false);

        return Ok(());
    }

    // delay double click only if triple click is registered
    let pos = mouse_pos()?;
    let (count, epoch) = record_click(
        Instant::now(),
        pos,
        is_valid_cursor,
        triple_click_registered,
    );
    match count {
        2 if triple_click_registered => {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(MAX_DBCLICK_INTERVAL).await;
                if TRIPLE_CLICK_REGISTERED.load(Ordering::Relaxed)
                    && !SHORTCUT_PAUSED.load(Ordering::Relaxed)
                    && SHORTCUT_SUSPEND.load(Ordering::Relaxed) == 0
                {
                    let _ = emit_event(DBCLICK_SHORTCUT, None, Some(epoch));
                }
            });
        }
        2 => emit_event(DBCLICK_SHORTCUT, None, None)?,
        3 => emit_event(TRIPLE_CLICK_SHORTCUT, None, None)?,
        _ => (),
    }

    Ok(())
}

/// Record whether the current press qualifies as a third click.
fn record_third_press(now: Instant, pos: (f64, f64)) {
    LAST_CLICK.set(LAST_CLICK.get().map(|mut click| {
        click.third_pressed = click.count == 2
            && now.duration_since(click.time) < MAX_DBCLICK_INTERVAL
            && distance(pos, click.pos) < MAX_DBCLICK_DISTANCE;
        click
    }));
}

/// Record mouse release and update consecutive click count.
fn record_click(
    now: Instant,
    pos: (f64, f64),
    is_valid_cursor: bool,
    triple_click_registered: bool,
) -> (u8, u64) {
    let epoch = *MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
    let mut click = Click {
        time: now,
        pos,
        valid_cursor: is_valid_cursor,
        count: 1,
        third_pressed: false,
        epoch,
    };
    if let Some(last) = LAST_CLICK.get() {
        let valid_interval = if last.count == 2 {
            last.third_pressed
        } else {
            now.duration_since(last.time) < MAX_DBCLICK_INTERVAL
        };
        if last.epoch == epoch
            && (is_valid_cursor || last.valid_cursor)
            && valid_interval
            && distance(pos, last.pos) < MAX_DBCLICK_DISTANCE
        {
            click.count = last.count + 1;
            click.valid_cursor |= last.valid_cursor;
        }
    }
    debug!("Detected mouse click count: {}", click.count);
    LAST_CLICK.set(
        if click.count == 3 || (click.count == 2 && !triple_click_registered) {
            None
        } else {
            Some(click)
        },
    );
    (click.count, epoch)
}

/// Cancel pending double click and optionally reset click sequence.
fn cancel_pending_click(reset_sequence: bool) {
    let mut current_epoch = MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
    let epoch = *current_epoch;
    *current_epoch = epoch.wrapping_add(1);
    // only the mouse listener updates its thread-local click state
    LAST_CLICK.set(
        LAST_CLICK
            .get()
            .filter(|click| !reset_sequence && click.epoch == epoch)
            .map(|mut click| {
                click.epoch = epoch.wrapping_add(1);
                click
            }),
    );
}

/// Dispatch pending double click if its epoch is still valid.
fn dispatch_pending_double_click(
    epoch: u64,
    dispatch: impl FnOnce() -> Result<(), AppError>,
) -> Result<bool, AppError> {
    let mut current_epoch = MOUSE_CLICK_EPOCH.lock().unwrap_or_else(|e| e.into_inner());
    if *current_epoch != epoch {
        return Ok(false);
    }
    *current_epoch = epoch.wrapping_add(1);
    dispatch()?;
    Ok(true)
}

/// Calculate distance between two points.
fn distance(p1: (f64, f64), p2: (f64, f64)) -> f64 {
    ((p1.0 - p2.0).powi(2) + (p1.1 - p2.1).powi(2)).sqrt()
}

/// Get current mouse position using enigo.
/// Returns physical coordinates on Windows, logical coordinates on macOS.
fn mouse_pos() -> Result<(f64, f64), AppError> {
    Ok(ENIGO
        .lock()?
        .as_ref()?
        .location()
        .map(|(x, y)| (x as f64, y as f64))?)
}

/// Check if current cursor is I-beam.
fn is_ibeam_cursor() -> bool {
    if IBEAM_CURSOR.load(Ordering::Relaxed) {
        platform::is_ibeam_cursor()
    } else {
        // if I-beam cursor check is disabled, consider all cursors as valid
        true
    }
}

/// Emit mouse event to frontend with optional selection fetching.
fn emit_event(
    shortcut: &str,
    with_selection: Option<bool>,
    click_epoch: Option<u64>,
) -> Result<(), AppError> {
    if let Some(app) = APP_HANDLE.lock()?.as_ref() {
        // check if current frontmost application/website is in blacklist
        if let Ok(true) = is_blocked(app.clone()) {
            return Ok(());
        }

        // emit event directly without fetching selection
        if !with_selection.unwrap_or(false) {
            let event_data = serde_json::json!({
                "shortcut": shortcut,
                "selection": ""
            });
            if let Some(epoch) = click_epoch {
                // recheck click epoch after locking APP_HANDLE and checking blacklist
                // keep the lock until the event is emitted to prevent cancellation races
                dispatch_pending_double_click(epoch, || {
                    app.emit("shortcut", event_data)?;
                    Ok(())
                })?;
                return Ok(());
            }
            let _ = app.emit("shortcut", event_data);
            return Ok(());
        }

        // get selection asynchronously and emit event
        let app_handle = app.clone();
        let shortcut = shortcut.to_string();
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_handle.clone(), Some(true)).await {
                if !selection.trim().is_empty() {
                    // emit event if selection is not empty
                    let event_data = serde_json::json!({
                        "shortcut": shortcut,
                        "selection": selection
                    });
                    let _ = app_handle.emit("shortcut", event_data);
                }
            }
        });
    }

    Ok(())
}

/// Close native action menu if it is open.
/// Returns true when the key was handled and should not hide the toolbar.
fn close_native_menu(key: Key, platform_code: u32) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    let _ = platform_code;

    if !TOOLBAR_MENU_OPEN.load(Ordering::Relaxed) {
        return Ok(false);
    }

    if matches!(key, Key::Escape) {
        TOOLBAR_MENU_OPEN.store(false, Ordering::Relaxed);
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    if matches!(key, Key::ControlLeft | Key::ControlRight) {
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    if matches!(key, Key::MetaLeft | Key::MetaRight)
        || matches!(platform_code, MACOS_LEFT_COMMAND | MACOS_RIGHT_COMMAND)
    {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    let copy_shortcut = (matches!(key, Key::KeyC) || platform_code == WINDOWS_KEY_C)
        && (COPY_MODIFIER_PRESSED.get() || windows_control_key_pressed());

    #[cfg(target_os = "macos")]
    let copy_shortcut = (matches!(key, Key::KeyC) || platform_code == MACOS_KEY_C)
        && (COPY_MODIFIER_PRESSED.get() || macos_command_key_pressed());

    if TOOLBAR_MENU_OPEN.swap(false, Ordering::Relaxed) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;

            let _guard = ShortcutHandlerGuard::suspend();
            let escape_result = (|| -> Result<(), AppError> {
                let mut enigo_guard = ENIGO.lock()?;
                let enigo = enigo_guard.as_mut()?;
                Ok(enigo.key(EnigoKey::Escape, Direction::Click)?)
            })();

            if let Err(error) = escape_result {
                debug!("Native menu close failed: {:?}", error);
                return;
            }

            if copy_shortcut {
                tokio::time::sleep(Duration::from_millis(100)).await;

                if let Some(app) = APP_HANDLE
                    .lock()
                    .ok()
                    .and_then(|guard| guard.as_ref().cloned())
                {
                    let _ = app.run_on_main_thread(|| {
                        let _ = send_copy_keys(Some(true), Some(true));
                    });
                } else {
                    let _ = send_copy_keys(Some(true), Some(true));
                }
            }
        });

        return Ok(false);
    }

    Ok(false)
}

/// Hide toolbar if click is outside its bounds.
fn hide_toolbar(check_position: bool) -> Result<(), AppError> {
    // get toolbar window
    let toolbar = APP_HANDLE
        .lock()?
        .as_ref()
        .and_then(|app| app.get_webview_window("toolbar"))
        .ok_or("Toolbar window not available")?;

    // check if toolbar is visible
    if !toolbar.is_visible().unwrap_or(false) {
        return Ok(());
    }

    // if no need to check position, hide directly
    if !check_position {
        let _ = toolbar.close();
        return Ok(());
    }

    // get mouse click position
    let (click_x, click_y) = mouse_pos()?;

    // get scale factor for coordinate conversion
    #[cfg(target_os = "windows")]
    let scale_factor = 1.0;
    #[cfg(not(target_os = "windows"))]
    let scale_factor = toolbar
        .current_monitor()?
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    // get toolbar position and size
    // convert to logical coordinates on macOS
    let toolbar_pos = toolbar.outer_position()?;
    let toolbar_size = toolbar.outer_size()?;
    let toolbar_x = toolbar_pos.x as f64 / scale_factor;
    let toolbar_y = toolbar_pos.y as f64 / scale_factor;
    let toolbar_width = toolbar_size.width as f64 / scale_factor;
    let toolbar_height = toolbar_size.height as f64 / scale_factor;

    // check if click is outside toolbar bounds
    let is_outside = click_x < toolbar_x
        || click_x > toolbar_x + toolbar_width
        || click_y < toolbar_y
        || click_y > toolbar_y + toolbar_height;

    if is_outside {
        // the close request is intercepted in lib.rs to emit hide event
        let _ = toolbar.close();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn click_sequences_keep_double_and_triple_clicks_exclusive() {
        let start = Instant::now();
        let pos = (10.0, 10.0);

        // check click counts with and without triple click registration
        for (registered, expected) in [(false, [1, 2, 1, 2]), (true, [1, 2, 3, 1])] {
            cancel_pending_click(true);
            for (index, count) in expected.into_iter().enumerate() {
                cancel_pending_click(false);
                record_third_press(start + Duration::from_millis(index as u64 * 100), pos);
                assert_eq!(
                    record_click(
                        start + Duration::from_millis(index as u64 * 100),
                        pos,
                        true,
                        registered,
                    )
                    .0,
                    count,
                );
            }
        }

        // check interval, distance and cursor limits for consecutive clicks
        for (interval, offset, valid_cursor, expected) in [
            (499, 2.0, true, 3),
            (500, 0.0, true, 1),
            (100, 3.0, true, 1),
            (100, 0.0, false, 1),
        ] {
            cancel_pending_click(true);
            let mut count = 0;
            for index in 0..3 {
                cancel_pending_click(false);
                record_third_press(
                    start + Duration::from_millis(index * interval),
                    (pos.0 + index as f64 * offset, pos.1),
                );
                count = record_click(
                    start + Duration::from_millis(index * interval),
                    (pos.0 + index as f64 * offset, pos.1),
                    valid_cursor,
                    true,
                )
                .0;
            }
            assert_eq!(count, expected);
        }

        // emit once on timeout and start a new click sequence afterward
        cancel_pending_click(true);
        record_click(start, pos, true, true);
        let (_, epoch) = record_click(start + Duration::from_millis(100), pos, true, true);
        let mut emitted = 0;
        assert!(dispatch_pending_double_click(epoch, || {
            emitted += 1;
            Ok(())
        })
        .unwrap());
        assert!(
            !dispatch_pending_double_click(epoch, || panic!("duplicate double click")).unwrap()
        );
        assert_eq!(emitted, 1);
        cancel_pending_click(false);
        assert_eq!(
            record_click(start + Duration::from_millis(601), pos, true, true).0,
            1,
        );

        // cancel pending double click on third press and preserve the click count
        let (_, epoch) = record_click(start + Duration::from_millis(700), pos, true, true);
        cancel_pending_click(false);
        record_third_press(start + Duration::from_millis(750), pos);
        assert!(!dispatch_pending_double_click(epoch, || panic!("canceled double click")).unwrap());
        assert_eq!(
            record_click(start + Duration::from_millis(800), pos, true, true).0,
            3,
        );

        // cancel pending double click and reset the click sequence on other input
        record_click(start + Duration::from_millis(900), pos, true, true);
        let (_, epoch) = record_click(start + Duration::from_millis(1000), pos, true, true);
        cancel_pending_click(true);
        assert!(!dispatch_pending_double_click(epoch, || panic!("canceled double click")).unwrap());
        assert_eq!(
            record_click(start + Duration::from_millis(1100), pos, true, true).0,
            1,
        );

        // invalidate click state when registration changes or handling is suspended
        *MOUSE_CLICK_EPOCH.lock().unwrap() += 1;
        cancel_pending_click(false);
        assert_eq!(
            record_click(start + Duration::from_millis(1200), pos, true, false).0,
            1,
        );
        cancel_pending_click(true);

        // accept a timely third press even if release occurs after 500ms
        // reject late presses or clicks outside the distance limit
        for (press_ms, press_offset, release_offset, expected) in [
            (450, 0.0, 0.0, 3),
            (499, 0.0, 0.0, 3),
            (500, 0.0, 0.0, 1),
            (501, 0.0, 0.0, 1),
            (450, 3.0, 0.0, 1),
            (450, 0.0, 3.0, 1),
        ] {
            cancel_pending_click(true);
            record_click(start, pos, true, true);
            let second_release = start + Duration::from_millis(100);
            let (_, epoch) = record_click(second_release, pos, true, true);
            cancel_pending_click(false);
            record_third_press(
                second_release + Duration::from_millis(press_ms),
                (pos.0 + press_offset, pos.1),
            );
            assert!(!dispatch_pending_double_click(epoch, || panic!(
                "double before third release"
            ))
            .unwrap());
            assert_eq!(
                record_click(
                    second_release + Duration::from_millis(550),
                    (pos.0 + release_offset, pos.1),
                    true,
                    true,
                )
                .0,
                expected,
            );
        }

        // invalidate recorded third press on other gestures or epoch changes
        for reset_sequence in [false, true] {
            cancel_pending_click(true);
            record_click(start, pos, true, true);
            record_click(start + Duration::from_millis(100), pos, true, true);
            cancel_pending_click(false);
            record_third_press(start + Duration::from_millis(550), pos);
            if reset_sequence {
                cancel_pending_click(true);
            } else {
                *MOUSE_CLICK_EPOCH.lock().unwrap() += 1;
            }
            assert_eq!(
                record_click(start + Duration::from_millis(650), pos, true, true).0,
                1,
            );
        }

        // cancel during blacklist or lock preparation before the final dispatch check
        cancel_pending_click(true);
        record_click(start, pos, true, true);
        let (_, epoch) = record_click(start + Duration::from_millis(100), pos, true, true);
        std::thread::spawn(|| cancel_pending_click(true))
            .join()
            .unwrap();
        assert!(!dispatch_pending_double_click(epoch, || panic!("stale dispatch")).unwrap());

        // finish event dispatch before another thread can cancel it
        cancel_pending_click(true);
        record_click(start, pos, true, true);
        let (_, epoch) = record_click(start + Duration::from_millis(100), pos, true, true);
        let (start_cancel, cancel_ready) = std::sync::mpsc::channel();
        let (lock_checked, lock_result) = std::sync::mpsc::channel();
        let cancellation = std::thread::spawn(move || {
            cancel_ready.recv().unwrap();
            let available = MOUSE_CLICK_EPOCH.try_lock().is_ok();
            lock_checked.send(available).unwrap();
            cancel_pending_click(true);
        });
        assert!(dispatch_pending_double_click(epoch, || {
            start_cancel.send(()).unwrap();
            assert!(
                !lock_result.recv().unwrap(),
                "cancellation slipped ahead of emit"
            );
            Ok(())
        })
        .unwrap());
        cancellation.join().unwrap();
        assert!(!dispatch_pending_double_click(epoch, || panic!("replayed dispatch")).unwrap());
        cancel_pending_click(true);
    }

    #[test]
    fn copy_detection_distinguishes_simulated_and_user_input() {
        #[cfg(target_os = "macos")]
        let modifier = Key::MetaLeft;
        #[cfg(target_os = "windows")]
        let modifier = Key::ControlLeft;

        // A late synthetic event reaches this detector after shortcut handling resumes.
        // Other applications' injected shortcuts must still count as user copy operations.
        for (marker, should_interrupt) in [
            (SIMULATED_INPUT_MARKER, false),
            (0, true),
            (enigo::EVENT_MARKER, true),
        ] {
            COPY_MODIFIER_PRESSED.set(false);
            CLIPBOARD_RESTORE_INTERRUPTED.store(false, Ordering::Relaxed);
            for event_type in [
                EventType::KeyPress(modifier),
                EventType::KeyPress(Key::KeyC),
                EventType::KeyRelease(Key::KeyC),
                EventType::KeyRelease(modifier),
            ] {
                let event = Event {
                    time: SystemTime::now(),
                    unicode: None,
                    event_type,
                    platform_code: 0,
                    position_code: 0,
                    usb_hid: 0,
                    extra_data: marker as _,
                };
                detect_user_copy_operation(&event);
            }
            assert_eq!(
                CLIPBOARD_RESTORE_INTERRUPTED.swap(false, Ordering::Relaxed),
                should_interrupt,
                "unexpected copy interruption for marker {marker:#x}",
            );
        }
    }
}
