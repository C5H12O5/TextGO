use crate::error::AppError;
use crate::platform;
use crate::ENIGO;
use enigo::Mouse;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// window position offset from cursor
const WINDOW_OFFSET: i32 = 10;

// bottom safe area offset to avoid taskbar/dock
const SAFE_AREA_BOTTOM: i32 = 80;

/// Show main window.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_window(&app, "main");
}

/// Hide main window.
#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    hide_window(&app, "main");
}

/// Toggle main window visibility.
#[tauri::command]
pub fn toggle_main_window(app: AppHandle) {
    toggle_window(&app, "main");
}

/// Navigate to shortcut registration page.
#[tauri::command]
pub fn goto_shortcuts(app: AppHandle) {
    if let Some(window) = show_window(&app, "main") {
        // emit page navigation event
        let _ = window.emit("goto-shortcuts", ());
    }
}

/// Show popup and position it near the cursor.
#[tauri::command]
pub fn show_popup(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("popup") {
        // position window near cursor
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;

        // show and focus window
        show_window(&app, "popup");

        // send data
        window.emit("show-popup", payload)?;
    } else {
        return Err("Popup window not found".into());
    }

    Ok(())
}

/// Show toolbar and position it near the cursor.
#[tauri::command]
pub fn show_toolbar(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("toolbar") {
        // position window near cursor
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;

        // show window
        window.show()?;

        // send data
        window.emit("show-toolbar", payload)?;
    } else {
        return Err("Toolbar window not found".into());
    }

    Ok(())
}

/// Position a window near the mouse or selection with safe area constraints.
fn position_window_near_cursor(window: &WebviewWindow, mouse: bool) -> Result<(), AppError> {
    // get cursor position
    let (x, y) = if mouse {
        // directly use mouse position from enigo
        ENIGO.lock()?.as_ref()?.location()?
    } else {
        // try to get selection location first, fall back to mouse position if failed
        match platform::get_cursor_location() {
            Ok(location) => location,
            Err(_) => ENIGO.lock()?.as_ref()?.location()?,
        }
    };

    // get window size
    let window_size = window.outer_size()?;
    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;

    // get current monitor info
    let monitor = window
        .current_monitor()?
        .ok_or_else(|| AppError::from("No monitor found"))?;
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale_factor = monitor.scale_factor();

    // convert physical pixels to logical pixels
    let screen_width = (monitor_size.width as f64 / scale_factor) as i32;
    let screen_height = (monitor_size.height as f64 / scale_factor) as i32;
    let screen_x = (monitor_position.x as f64 / scale_factor) as i32;
    let screen_y = (monitor_position.y as f64 / scale_factor) as i32;

    // calculate safe area for window
    let min_x = screen_x;
    let max_x = screen_x + screen_width - window_width;
    let min_y = screen_y;
    let max_y = screen_y + screen_height - window_height - SAFE_AREA_BOTTOM;

    // set adjusted window position
    window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
        x: (x + WINDOW_OFFSET).clamp(min_x, max_x) as f64,
        y: (y + WINDOW_OFFSET).clamp(min_y, max_y) as f64,
    }))?;

    // add some delay to prevent flickering
    if !window.is_visible()? {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Ok(())
}

/// Show and focus window.
pub fn show_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_minimized().unwrap_or(false) {
            // unminimize
            let _ = window.unminimize();
        } else {
            // show window
            let _ = window.show();
        }
        // focus window
        let _ = window.set_focus();

        Some(window)
    } else {
        None
    }
}

/// Hide window.
pub fn hide_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();

        // also hide dock icon on macOS
        #[cfg(target_os = "macos")]
        if label == "main" {
            let _ = app.set_dock_visibility(false);
        }

        Some(window)
    } else {
        None
    }
}

/// Toggle window visibility.
pub fn toggle_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        // check if window is minimized
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
            return Some(window);
        }

        // check if window is not visible
        if !window.is_visible().unwrap_or(false) {
            return show_window(app, label);
        }

        // check if window is not focused
        #[cfg(target_os = "macos")]
        if !window.is_focused().unwrap_or(false) {
            return show_window(app, label);
        }

        // hide when window is visible and not minimized
        hide_window(app, label)
    } else {
        None
    }
}
