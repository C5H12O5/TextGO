use crate::commands::get_selection;
use crate::error::AppError;
use crate::{APP_HANDLE, ENIGO, SHORTCUT_PAUSED};
use enigo::Mouse;
use rdev::{Button, Event, EventType};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

// mouse event tracking states
static LAST_CLICK_TIME: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));
static DRAG_START_POS: LazyLock<Mutex<Option<(f64, f64)>>> = LazyLock::new(|| Mutex::new(None));
static IS_DRAGGING: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

/// Handle mouse event.
pub fn handle_mouse_event(event: Event) {
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
        _ => (),
    }
}

/// Handle mouse press event (detect drag start).
fn handle_mouse_press() -> Result<(), AppError> {
    // start tracking potential drag
    let pos = mouse_pos()?;
    if let Ok(mut drag_start_pos) = DRAG_START_POS.lock() {
        *drag_start_pos = Some(pos);
    }

    // hide toolbar on mouse press
    hide_toolbar()?;

    Ok(())
}

/// Handle mouse move event (detect dragging).
fn handle_mouse_move(x: f64, y: f64) -> Result<(), AppError> {
    if let Ok(start_pos) = DRAG_START_POS.lock() {
        if let Some((start_x, start_y)) = *start_pos {
            // check if moved enough to be considered a drag (>5 pixels)
            let distance = ((x - start_x).powi(2) + (y - start_y).powi(2)).sqrt();
            if distance > 5.0 {
                if let Ok(mut is_dragging) = IS_DRAGGING.lock() {
                    if !*is_dragging {
                        *is_dragging = true;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handle mouse release event (detect drag end or double click).
fn handle_mouse_release() -> Result<(), AppError> {
    // reset drag start position
    if let Ok(mut drag_start_pos) = DRAG_START_POS.lock() {
        *drag_start_pos = None;
    }

    // check for drag end
    if let Ok(mut is_dragging) = IS_DRAGGING.lock() {
        if *is_dragging {
            // emit drag end event
            emit_event("MouseClick+MouseMove")?;
            *is_dragging = false;
            return Ok(());
        }
    }

    // check for double click (within 500ms)
    let now = Instant::now();
    let is_double_click = if let Ok(mut last_click_time) = LAST_CLICK_TIME.lock() {
        if let Some(last) = *last_click_time {
            let elapsed = now.duration_since(last);
            if elapsed < Duration::from_millis(500) {
                // reset after detecting double click
                *last_click_time = None;
                true
            } else {
                *last_click_time = Some(now);
                false
            }
        } else {
            *last_click_time = Some(now);
            false
        }
    } else {
        false
    };
    if is_double_click {
        // emit double click event
        emit_event("MouseClick+MouseClick")?;
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
    // check if shortcut processing is paused
    if let Ok(paused) = SHORTCUT_PAUSED.lock() {
        if *paused {
            return Ok(());
        }
    }

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
