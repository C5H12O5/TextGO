use crate::error::AppError;
use crate::platform;
use crate::ENIGO;
use enigo::Mouse;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, WebviewWindow};
use tokio::time::sleep;

// structure to hold window placement information
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    pub screen_size: Option<LogicalSize<f64>>,
    pub screen_position: Option<LogicalPosition<f64>>,
    pub window_position: LogicalPosition<f64>,
}

// window position offset from cursor
const WINDOW_OFFSET: i32 = 5;

// bottom safe area offset to avoid taskbar/dock
const SAFE_AREA_BOTTOM: i32 = 80;

// maximum wait time for window initialization
const INITIALIZATION_TIMEOUT_MS: u64 = 5000;

// initialization flags for popup and toolbar windows
static POPUP_INITIALIZED: AtomicBool = AtomicBool::new(false);
static TOOLBAR_INITIALIZED: AtomicBool = AtomicBool::new(false);

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

/// Navigate to a specific page in the main window.
#[tauri::command]
pub fn navigate_to(app: AppHandle, url: String) {
    if let Some(window) = show_window(&app, "main") {
        // emit page navigation event
        let _ = window.emit("goto", url);
    }
}

/// Mark popup window as initialized.
#[tauri::command]
pub fn mark_popup_initialized() {
    POPUP_INITIALIZED.store(true, Ordering::Relaxed);
}

/// Mark toolbar window as initialized.
#[tauri::command]
pub fn mark_toolbar_initialized() {
    TOOLBAR_INITIALIZED.store(true, Ordering::Relaxed);
}

/// Show popup window and position it near the cursor.
#[tauri::command]
pub fn show_popup(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("popup") {
        // position window near cursor
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;

        // show and focus window
        if !POPUP_INITIALIZED.load(Ordering::Relaxed) {
            show_window(&app, "popup");
        }

        // wait for initialization and emit event
        wait_and_emit(&POPUP_INITIALIZED, window, payload);
    } else {
        return Err("Popup window not found".into());
    }

    Ok(())
}

/// Show popup window and position it at the given logical position.
#[tauri::command]
pub fn show_popup_sameplace(
    app: AppHandle,
    payload: String,
    placement: WindowPlacement,
) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("popup") {
        // set window position with safe area constraints if screen info is provided
        let position = if let (Some(screen_size), Some(screen_position)) =
            (placement.screen_size, placement.screen_position)
        {
            // get popup window size
            let window_size = window.outer_size()?;
            let scale_factor = window.scale_factor()?;
            let window_width = window_size.width as f64 / scale_factor;
            let window_height = window_size.height as f64 / scale_factor;

            // get screen size and position
            let screen_width = screen_size.width;
            let screen_height = screen_size.height;
            let screen_x = screen_position.x;
            let screen_y = screen_position.y;

            // calculate safe area for window
            let min_x = screen_x;
            let max_x = (screen_x + screen_width - window_width).max(min_x);
            let min_y = screen_y;
            let max_y =
                (screen_y + screen_height - window_height - SAFE_AREA_BOTTOM as f64).max(min_y);

            // clamp window position to safe area
            LogicalPosition {
                x: placement.window_position.x.clamp(min_x, max_x),
                y: placement.window_position.y.clamp(min_y, max_y),
            }
        } else {
            // use window position directly if screen info is not available
            placement.window_position
        };

        window.set_position(Position::Logical(position))?;

        // show and focus window
        if !POPUP_INITIALIZED.load(Ordering::Relaxed) {
            show_window(&app, "popup");
        }

        // wait for initialization and emit event
        wait_and_emit(&POPUP_INITIALIZED, window, payload);
    } else {
        return Err("Popup window not found".into());
    }

    Ok(())
}

/// Show toolbar window and position it near the cursor.
#[tauri::command]
pub fn show_toolbar(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("toolbar") {
        // position window near cursor
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;

        // show window without focusing
        if !TOOLBAR_INITIALIZED.load(Ordering::Relaxed) {
            show_toolbar_regardless(app.clone())?;
        }

        // wait for initialization and emit event
        wait_and_emit(&TOOLBAR_INITIALIZED, window, payload);
    } else {
        return Err("Toolbar window not found".into());
    }

    Ok(())
}

/// Show toolbar window without focusing it.
#[tauri::command]
pub fn show_toolbar_regardless(app: AppHandle) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel("toolbar") {
            // bring to front without making key
            panel.order_front_regardless();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("toolbar") {
            window.show()?;
        }
    }

    Ok(())
}

/// Wait for window initialization and emit event.
///
/// If already initialized, emit event immediately.
/// Otherwise, spawn async task to wait and then emit.
fn wait_and_emit(flag: &'static AtomicBool, window: WebviewWindow, payload: String) {
    // get window label and construct event name
    let window_label = window.label().to_string();
    let event_name = format!("show-{}", window_label);

    // if already initialized, emit immediately
    if flag.load(Ordering::Relaxed) {
        let _ = window.emit(&event_name, payload);
        return;
    }

    // spawn async task to wait for initialization and send data
    tauri::async_runtime::spawn(async move {
        // wait for initialization with timeout
        const CHECK_INTERVAL_MS: u64 = 10;
        const MAX_CHECKS: u64 = INITIALIZATION_TIMEOUT_MS / CHECK_INTERVAL_MS;
        for _ in 0..MAX_CHECKS {
            sleep(Duration::from_millis(CHECK_INTERVAL_MS)).await;
            if flag.load(Ordering::Relaxed) {
                break;
            }
        }

        // emit event after initialization or timeout
        let _ = window.emit(&event_name, payload);
    });
}

/// Position a window near the mouse or selection with safe area constraints.
fn position_window_near_cursor(window: &WebviewWindow, mouse: bool) -> Result<(), AppError> {
    // get cursor position (may be physical or logical depending on platform)
    let mut mouse_position = true;

    #[allow(unused_mut)]
    let (mut x, mut y) = if mouse {
        // directly use mouse position from enigo
        ENIGO.lock()?.as_ref()?.location()?
    } else {
        // try to get selection location first, fall back to mouse position if failed
        match platform::get_cursor_location() {
            Ok(location) => {
                mouse_position = false;
                location
            }
            Err(_) => ENIGO.lock()?.as_ref()?.location()?,
        }
    };

    // get window size
    let window_size = window.outer_size()?;
    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;

    // get monitor at cursor position
    let monitor = window
        .available_monitors()?
        .into_iter()
        .find(|m| {
            let pos = m.position();
            let size = m.size();

            // check against physical coordinates on Windows, logical on macOS
            #[cfg(target_os = "windows")]
            {
                x >= pos.x
                    && x < pos.x + size.width as i32
                    && y >= pos.y
                    && y < pos.y + size.height as i32
            }
            #[cfg(not(target_os = "windows"))]
            {
                let scale = m.scale_factor();
                let logical_x = (pos.x as f64 / scale) as i32;
                let logical_y = (pos.y as f64 / scale) as i32;
                let logical_width = (size.width as f64 / scale) as i32;
                let logical_height = (size.height as f64 / scale) as i32;

                x >= logical_x
                    && x < logical_x + logical_width
                    && y >= logical_y
                    && y < logical_y + logical_height
            }
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .ok_or_else(|| AppError::from("No monitor found"))?;

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale_factor = monitor.scale_factor();

    // convert physical pixels to logical pixels
    #[cfg(target_os = "windows")]
    {
        x = (x as f64 / scale_factor) as i32;
        y = (y as f64 / scale_factor) as i32;
    }

    let window_width = (window_width as f64 / scale_factor) as i32;
    let window_height = (window_height as f64 / scale_factor) as i32;
    let screen_width = (monitor_size.width as f64 / scale_factor) as i32;
    let screen_height = (monitor_size.height as f64 / scale_factor) as i32;
    let screen_x = (monitor_position.x as f64 / scale_factor) as i32;
    let screen_y = (monitor_position.y as f64 / scale_factor) as i32;

    // calculate safe area for window
    let min_x = screen_x;
    let max_x = (screen_x + screen_width - window_width).max(min_x);
    let min_y = screen_y;
    let max_y = (screen_y + screen_height - window_height - SAFE_AREA_BOTTOM).max(min_y);

    // set adjusted window position
    let window_offset = if mouse_position {
        WINDOW_OFFSET
    } else {
        -WINDOW_OFFSET
    };
    window.set_position(Position::Logical(LogicalPosition {
        x: (x + window_offset).clamp(min_x, max_x) as f64,
        y: (y + window_offset).clamp(min_y, max_y) as f64,
    }))?;

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
