use crate::commands::{get_selection, is_blocked};
use crate::error::AppError;
use crate::platform;
use crate::{
    APP_HANDLE, ENIGO, LONG_PRESS, LONG_PRESS_DURATION, SHORTCUT_PAUSED, SHORTCUT_SUSPEND,
};
use enigo::Mouse;
use log::debug;
use rdev::{Button, Event, EventType, Key};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Type alias for mouse click data (time, position, is_valid_cursor).
type Click = (Instant, (f64, f64), bool);

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
}

// thresholds for drag and double click detection
const MIN_DRAG_DISTANCE: f64 = 8.0;
const MAX_DBCLICK_DISTANCE: f64 = 3.0;
const MAX_DBCLICK_INTERVAL: Duration = Duration::from_millis(500);

/// Handle mouse event.
pub fn handle_mouse_event(event: Event) {
    // check if shortcut handling is suspended or paused
    if SHORTCUT_SUSPEND.load(Ordering::Relaxed) || SHORTCUT_PAUSED.load(Ordering::Relaxed) {
        return;
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
            // hide toolbar on key press
            let _ = hide_toolbar(false);
        }
        EventType::KeyRelease(Key::ShiftLeft) | EventType::KeyRelease(Key::ShiftRight) => {
            SHIFT_PRESSED.set(false);
        }
        EventType::Wheel { .. } => {
            // hide toolbar on wheel scroll
            let _ = hide_toolbar(false);
        }
        _ => (),
    }
}

/// Handle mouse press event (detect drag start).
fn handle_mouse_press() -> Result<(), AppError> {
    // start tracking potential drag
    let pos = mouse_pos()?;
    DRAG_START_POS.set(Some(pos));
    IS_DRAGGING.set(false);

    // record if cursor is I-Beam
    let is_valid_cursor = platform::is_ibeam_cursor();
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
                debug!("long press triggered after {}ms", duration);
                LONG_PRESS_TRIGGERED.store(true, Ordering::Relaxed);
                let _ = emit_event("LongPress", Some(true));
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

/// Handle mouse release event (detect drag end or double click).
fn handle_mouse_release() -> Result<(), AppError> {
    // invalidate long press if mouse is released
    LONG_PRESS_EPOCH.fetch_add(1, Ordering::Relaxed);

    // reset drag start position
    DRAG_START_POS.set(None);

    // skip other events if long press was triggered
    if LONG_PRESS_TRIGGERED.load(Ordering::Relaxed) {
        LONG_PRESS_TRIGGERED.store(false, Ordering::Relaxed);
        IS_DRAGGING.set(false);
        return Ok(());
    }

    // only process text selection if cursor was valid
    // inspired by https://github.com/0xfullex/selection-hook
    let is_valid_cursor = IS_VALID_CURSOR.get() || platform::is_ibeam_cursor();

    // check for drag end
    if IS_DRAGGING.get() {
        debug!("checking for drag end (cursor: {})", is_valid_cursor);
        if is_valid_cursor {
            // emit drag end event
            emit_event("MouseClick+MouseMove", None)?;
        }
        IS_DRAGGING.set(false);
        return Ok(());
    }

    // check for shift+click
    if SHIFT_PRESSED.get() {
        debug!("checking for shift+click (cursor: {})", is_valid_cursor);
        if is_valid_cursor {
            // emit shift+click event
            emit_event("Shift+MouseClick", None)?;
        }

        // avoid sticky shift state on macOS
        #[cfg(target_os = "macos")]
        SHIFT_PRESSED.set(false);

        return Ok(());
    }

    // check for double click
    let pos = mouse_pos()?;
    let now = Instant::now();
    if let Some((last_time, last_pos, last_valid_cursor)) = LAST_CLICK.get() {
        let valid_cursor = is_valid_cursor || last_valid_cursor;
        let valid_interval = now.duration_since(last_time) < MAX_DBCLICK_INTERVAL;
        let valid_distance = distance(pos, last_pos) < MAX_DBCLICK_DISTANCE;
        debug!(
            "checking for double click (cursor: {}, interval: {}, distance: {})",
            valid_cursor, valid_interval, valid_distance
        );
        if valid_cursor && valid_interval && valid_distance {
            // emit double click event
            emit_event("MouseClick+MouseClick", None)?;
            // reset last click state
            LAST_CLICK.set(None);
        } else {
            LAST_CLICK.set(Some((now, pos, is_valid_cursor)));
        }
    } else {
        LAST_CLICK.set(Some((now, pos, is_valid_cursor)));
    }

    Ok(())
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

/// Emit mouse event to frontend with current selection.
fn emit_event(shortcut: &str, skip_selection: Option<bool>) -> Result<(), AppError> {
    if let Some(app) = APP_HANDLE.lock()?.as_ref() {
        // check if current frontmost application/website is in blacklist
        if let Ok(true) = is_blocked(app.clone()) {
            return Ok(());
        }

        // emit event directly without fetching selection
        if skip_selection.unwrap_or(false) {
            let event_data = serde_json::json!({
                "shortcut": shortcut,
                "selection": ""
            });
            let _ = app.emit("shortcut", event_data);
            return Ok(());
        }

        // get selection asynchronously and emit event
        let app_handle = app.clone();
        let shortcut = shortcut.to_string();
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_handle.clone()).await {
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
