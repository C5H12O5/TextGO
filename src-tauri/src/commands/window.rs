use crate::error::AppError;
use crate::platform;
use crate::{ENIGO, TOOLBAR_MENU_OPEN};
use enigo::Mouse;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, WebviewWindow};

// structure to hold window placement information
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    pub screen_size: Option<LogicalSize<f64>>,
    pub screen_position: Option<LogicalPosition<f64>>,
    pub window_position: LogicalPosition<f64>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolbarPosition {
    Top,
    TopRight,
    Right,
    Bottom,
    BottomRight,
}

// window position offset from cursor
const WINDOW_OFFSET: i32 = 5;

// additional toolbar offset range in logical pixels, matching TOOLBAR_POSITION_OFFSET
const TOOLBAR_POSITION_OFFSET_MIN: i32 = -200;
const TOOLBAR_POSITION_OFFSET_MAX: i32 = 200;

// bottom safe area offset to avoid taskbar/dock
const SAFE_AREA_BOTTOM: i32 = 80;

// maximum wait time for window initialization
const INITIALIZATION_TIMEOUT_MS: u64 = 5000;

// maximum time to wait for the popup source application to regain focus
const FOCUS_RESTORE_TIMEOUT_MS: u64 = 500;

// interval between source focus checks
const FOCUS_RESTORE_INTERVAL_MS: u64 = 10;

// initialization flags for popup and toolbar windows
static POPUP_INITIALIZED: AtomicBool = AtomicBool::new(false);
static TOOLBAR_INITIALIZED: AtomicBool = AtomicBool::new(false);
static TOOLBAR_POSITION: Mutex<ToolbarPosition> = Mutex::new(ToolbarPosition::BottomRight);
static TOOLBAR_POSITION_OFFSET: Mutex<(i32, i32)> = Mutex::new((0, 0));
static POPUP_SOURCE_FOCUS: LazyLock<Mutex<Option<platform::FocusTarget>>> =
    LazyLock::new(|| Mutex::new(None));

/// Activate a focus target and wait until the operating system reports it as active.
async fn restore_focus_with<T, Activate, IsActive, Sleep, SleepFuture>(
    target: T,
    activate: Activate,
    is_active: IsActive,
    sleep: Sleep,
) -> Result<(), AppError>
where
    T: Copy,
    Activate: FnOnce(T) -> Result<(), AppError>,
    IsActive: Fn(T) -> bool,
    Sleep: Fn(Duration) -> SleepFuture,
    SleepFuture: Future<Output = ()>,
{
    activate(target)?;

    let interval = Duration::from_millis(FOCUS_RESTORE_INTERVAL_MS);
    let max_checks = FOCUS_RESTORE_TIMEOUT_MS / FOCUS_RESTORE_INTERVAL_MS;
    for check in 0..=max_checks {
        if is_active(target) {
            return Ok(());
        }
        if check < max_checks {
            sleep(interval).await;
        }
    }

    Err("Failed to restore focus to popup source application".into())
}

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

/// Get the stable content scale used to size the toolbar window.
#[tauri::command]
pub fn get_toolbar_zoom_factor() -> f64 {
    #[cfg(target_os = "windows")]
    {
        platform::get_text_scale_factor()
    }
    #[cfg(not(target_os = "windows"))]
    {
        1.0
    }
}

/// Set toolbar native menu open state.
#[tauri::command]
pub fn set_toolbar_menu_open(open: bool) {
    TOOLBAR_MENU_OPEN.store(open, Ordering::Relaxed);
}

/// Set toolbar placement relative to the mouse or selection.
#[tauri::command]
pub fn set_toolbar_position(position: ToolbarPosition) -> Result<(), AppError> {
    *TOOLBAR_POSITION.lock()? = position;
    Ok(())
}

/// Update either toolbar offset without resetting the other axis.
#[tauri::command]
pub fn set_toolbar_position_offset(x: Option<i32>, y: Option<i32>) -> Result<(), AppError> {
    let mut offset = TOOLBAR_POSITION_OFFSET.lock()?;
    if let Some(x) = x {
        offset.0 = x.clamp(TOOLBAR_POSITION_OFFSET_MIN, TOOLBAR_POSITION_OFFSET_MAX);
    }
    if let Some(y) = y {
        offset.1 = y.clamp(TOOLBAR_POSITION_OFFSET_MIN, TOOLBAR_POSITION_OFFSET_MAX);
    }
    Ok(())
}

/// Show popup window and position it near the cursor.
#[tauri::command]
pub fn show_popup(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    *POPUP_SOURCE_FOCUS.lock()? = platform::get_focus_target();

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
    let mut source_focus = POPUP_SOURCE_FOCUS.lock()?;
    if source_focus.is_none() {
        *source_focus = platform::get_focus_target();
    }
    drop(source_focus);

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
            let safe_area_bottom = SAFE_AREA_BOTTOM as f64 / scale_factor;
            let min_x = screen_x;
            let max_x = (screen_x + screen_width - window_width).max(min_x);
            let min_y = screen_y;
            let max_y = (screen_y + screen_height - window_height - safe_area_bottom).max(min_y);

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

/// Position toolbar window near the mouse or selection.
#[tauri::command]
pub fn position_toolbar(app: AppHandle, mouse: Option<bool>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("toolbar") {
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;
    } else {
        return Err("Toolbar window not found".into());
    }

    Ok(())
}

/// Show toolbar window and position it near the cursor.
#[tauri::command]
pub fn show_toolbar(app: AppHandle, payload: String, mouse: Option<bool>) -> Result<(), AppError> {
    *POPUP_SOURCE_FOCUS.lock()? = platform::get_focus_target();

    if let Some(window) = app.get_webview_window("toolbar") {
        // position before setup so native-menu actions also inherit the current placement
        position_window_near_cursor(&window, mouse.unwrap_or(false))?;

        // show window without focusing
        if !TOOLBAR_INITIALIZED.load(Ordering::Relaxed) {
            show_toolbar_regardless(app.clone(), None)?;
        }

        // wait for initialization and emit event
        wait_and_emit(&TOOLBAR_INITIALIZED, window, payload);
    } else {
        return Err("Toolbar window not found".into());
    }

    Ok(())
}

/// Show toolbar window without focusing it.
///
/// When `only_if_hidden` is true, leave an already visible toolbar unchanged.
/// Return an error if the window/panel is missing or a visibility operation fails.
#[tauri::command]
pub fn show_toolbar_regardless(
    app: AppHandle,
    only_if_hidden: Option<bool>,
) -> Result<(), AppError> {
    let window = app
        .get_webview_window("toolbar")
        .ok_or("Toolbar window not found")?;
    if only_if_hidden.unwrap_or(false) && window.is_visible()? {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        let panel = app
            .get_webview_panel("toolbar")
            .map_err(|_| "Toolbar panel not found")?;
        // bring to front without making key
        panel.order_front_regardless();
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show()?;
        // refresh z-order to ensure toolbar stays on top
        window.set_always_on_top(false)?;
        window.set_always_on_top(true)?;
    }

    Ok(())
}

/// Restore focus to the application that opened the popup.
#[tauri::command]
pub async fn focus_popup_source() -> Result<(), AppError> {
    let target = POPUP_SOURCE_FOCUS
        .lock()?
        .take()
        .ok_or("Popup source focus target not found")?;

    restore_focus_with(
        target,
        platform::activate_focus_target,
        platform::is_focus_target_active,
        tokio::time::sleep,
    )
    .await
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
            tokio::time::sleep(Duration::from_millis(CHECK_INTERVAL_MS)).await;
            if flag.load(Ordering::Relaxed) {
                break;
            }
        }

        // emit event after initialization or timeout
        let _ = window.emit(&event_name, payload);
    });
}

/// Calculate toolbar offsets using its current size in logical pixels.
fn toolbar_position_offset(
    position: ToolbarPosition,
    width: i32,
    height: i32,
    default_offset: i32,
    additional_offset: (i32, i32),
) -> (i32, i32) {
    let (x, y) = match position {
        ToolbarPosition::Top => (-width / 2, -height - WINDOW_OFFSET),
        ToolbarPosition::TopRight => (WINDOW_OFFSET, -height - WINDOW_OFFSET),
        ToolbarPosition::Right => (WINDOW_OFFSET, -height / 2),
        ToolbarPosition::Bottom => (-width / 2, WINDOW_OFFSET),
        ToolbarPosition::BottomRight => (default_offset, default_offset),
    };
    let offset_y = if matches!(position, ToolbarPosition::Top | ToolbarPosition::TopRight) {
        -additional_offset.1
    } else {
        additional_offset.1
    };
    (x + additional_offset.0, y + offset_y)
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
    let safe_area_bottom = (SAFE_AREA_BOTTOM as f64 / scale_factor) as i32;
    let min_x = screen_x;
    let max_x = (screen_x + screen_width - window_width).max(min_x);
    let min_y = screen_y;
    let max_y = (screen_y + screen_height - window_height - safe_area_bottom).max(min_y);

    // set adjusted window position
    let window_offset = if mouse_position {
        WINDOW_OFFSET
    } else {
        -WINDOW_OFFSET
    };
    let (offset_x, offset_y) = if window.label() == "toolbar" {
        toolbar_position_offset(
            *TOOLBAR_POSITION.lock()?,
            window_width,
            window_height,
            window_offset,
            *TOOLBAR_POSITION_OFFSET.lock()?,
        )
    } else {
        (window_offset, window_offset)
    };
    window.set_position(Position::Logical(LogicalPosition {
        x: (x + offset_x).clamp(min_x, max_x) as f64,
        y: (y + offset_y).clamp(min_y, max_y) as f64,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolbar_positions_match_frontend_values() {
        let cases = [
            ("top", (280, 253)),
            ("top-right", (405, 253)),
            ("right", (405, 279)),
            ("bottom", (280, 305)),
            ("bottom-right", (405, 305)),
        ];
        for (value, expected) in cases {
            let position = serde_json::from_value(serde_json::json!(value)).unwrap();
            let (dx, dy) = toolbar_position_offset(position, 240, 42, WINDOW_OFFSET, (0, 0));
            assert_eq!((400 + dx, 300 + dy), expected, "{value}");
        }
    }

    #[test]
    fn default_toolbar_position_preserves_mouse_and_selection_offsets() {
        for offset in [WINDOW_OFFSET, -WINDOW_OFFSET] {
            assert_eq!(
                toolbar_position_offset(ToolbarPosition::BottomRight, 240, 42, offset, (0, 0)),
                (offset, offset)
            );
        }
    }

    #[test]
    fn centered_toolbar_positions_follow_window_size() {
        for (width, height) in [(409, 38), (466, 42), (523, 46)] {
            for position in [ToolbarPosition::Top, ToolbarPosition::Bottom] {
                let (dx, _) =
                    toolbar_position_offset(position, width, height, WINDOW_OFFSET, (0, 0));
                assert!((2 * dx + width).abs() <= 1);
            }
            let (dx, dy) = toolbar_position_offset(
                ToolbarPosition::Right,
                width,
                height,
                WINDOW_OFFSET,
                (0, 0),
            );
            assert_eq!(dx, WINDOW_OFFSET);
            assert!((2 * dy + height).abs() <= 1);
        }
    }

    #[test]
    fn toolbar_offsets_follow_selected_direction_with_both_signs() {
        let cases = [
            ("top", (300, 223), (260, 283)),
            ("top-right", (425, 223), (385, 283)),
            ("right", (425, 309), (385, 249)),
            ("bottom", (300, 335), (260, 275)),
            ("bottom-right", (425, 335), (385, 275)),
        ];
        for (value, positive, negative) in cases {
            let position = serde_json::from_value(serde_json::json!(value)).unwrap();
            for (offset, expected) in [((20, 30), positive), ((-20, -30), negative)] {
                let (dx, dy) = toolbar_position_offset(position, 240, 42, WINDOW_OFFSET, offset);
                assert_eq!((400 + dx, 300 + dy), expected, "{value}: {offset:?}");
            }
        }
    }

    #[test]
    fn toolbar_offset_updates_preserve_other_axis_and_clamp_values() {
        set_toolbar_position_offset(Some(25), Some(-30)).unwrap();
        set_toolbar_position_offset(Some(250), None).unwrap();
        assert_eq!(*TOOLBAR_POSITION_OFFSET.lock().unwrap(), (200, -30));
        set_toolbar_position_offset(None, Some(-250)).unwrap();
        assert_eq!(*TOOLBAR_POSITION_OFFSET.lock().unwrap(), (200, -200));
        set_toolbar_position_offset(Some(0), Some(0)).unwrap();
    }
}
