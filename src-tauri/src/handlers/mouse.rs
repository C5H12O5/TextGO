use crate::commands::get_selection;
use crate::error::AppError;
use crate::{APP_HANDLE, ENIGO, SHORTCUT_PAUSED, SHORTCUT_SUSPEND};
use enigo::Mouse;
use rdev::{Button, Event, EventType};
use std::cell::Cell;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

// mouse event tracking states
thread_local! {
    static DRAG_START_POS: Cell<Option<(f64, f64)>> = const { Cell::new(None) };
    static IS_DRAGGING: Cell<bool> = const { Cell::new(false) };
    static LAST_CLICK: Cell<Option<(Instant, (f64, f64))>> = const { Cell::new(None) };
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
        EventType::Wheel { .. } | EventType::KeyPress(_) => {
            // hide toolbar on wheel scroll or key press
            let _ = hide_toolbar();
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

    // hide toolbar on mouse press
    hide_toolbar()?;

    Ok(())
}

/// Handle mouse move event (detect dragging).
fn handle_mouse_move(x: f64, y: f64) -> Result<(), AppError> {
    if let Some((start_x, start_y)) = DRAG_START_POS.get() {
        // check if moved enough to be considered a drag
        let distance = ((x - start_x).powi(2) + (y - start_y).powi(2)).sqrt();
        if distance > MIN_DRAG_DISTANCE {
            IS_DRAGGING.set(true);
        }
    }

    Ok(())
}

/// Handle mouse release event (detect drag end or double click).
fn handle_mouse_release() -> Result<(), AppError> {
    // reset drag start position
    DRAG_START_POS.set(None);

    // check for drag end
    if IS_DRAGGING.get() {
        // emit drag end event
        emit_event("MouseClick+MouseMove")?;
        IS_DRAGGING.set(false);
        return Ok(());
    }

    // check for double click
    let pos = mouse_pos()?;
    let now = Instant::now();
    if let Some((last_time, last_pos)) = LAST_CLICK.get() {
        let interval = now.duration_since(last_time);
        let distance = ((pos.0 - last_pos.0).powi(2) + (pos.1 - last_pos.1).powi(2)).sqrt();
        if (interval < MAX_DBCLICK_INTERVAL) && (distance < MAX_DBCLICK_DISTANCE) {
            // emit double click event
            emit_event("MouseClick+MouseClick")?;
            // reset last click state
            LAST_CLICK.set(None);
        } else {
            LAST_CLICK.set(Some((now, pos)));
        }
    } else {
        LAST_CLICK.set(Some((now, pos)));
    }

    Ok(())
}

/// Get current mouse position using enigo.
fn mouse_pos() -> Result<(f64, f64), AppError> {
    Ok(ENIGO
        .lock()?
        .as_ref()?
        .location()
        .map(|(x, y)| (x as f64, y as f64))?)
}

/// Emit mouse event to frontend with current selection.
fn emit_event(shortcut: &str) -> Result<(), AppError> {
    // get selection asynchronously and emit event
    if let Some(app) = APP_HANDLE.lock()?.as_ref() {
        let app_handle = app.clone();
        let shortcut = shortcut.to_string();
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_handle.clone()).await {
                if !selection.is_empty() {
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
fn hide_toolbar() -> Result<(), AppError> {
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

    // get mouse click position
    let (click_x, click_y) = mouse_pos()?;

    // get toolbar position and size
    let toolbar_pos = toolbar.outer_position()?;
    let toolbar_size = toolbar.outer_size()?;
    let toolbar_x = toolbar_pos.x as f64;
    let toolbar_y = toolbar_pos.y as f64;
    let toolbar_width = toolbar_size.width as f64;
    let toolbar_height = toolbar_size.height as f64;

    // check if click is outside toolbar bounds
    let is_outside = click_x < toolbar_x
        || click_x > toolbar_x + toolbar_width
        || click_y < toolbar_y
        || click_y > toolbar_y + toolbar_height;

    if is_outside {
        // hide toolbar
        let _ = toolbar.hide();
    }

    Ok(())
}
