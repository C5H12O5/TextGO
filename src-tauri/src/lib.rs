mod commands;
mod error;
mod handlers;
mod platform;

use clipboard_rs::ClipboardContext;
use commands::*;
use enigo::{Enigo, Settings};
use fern::colors::ColoredLevelConfig;
use handlers::{handle_keyboard_event, handle_mouse_event};
use log::LevelFilter;
use rdev::listen;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{LazyLock, Mutex};
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, WebviewWindow, WindowEvent};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

// global app handle storage
pub static APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(|| Mutex::new(None));

// global shortcut paused state
pub static SHORTCUT_PAUSED: AtomicBool = AtomicBool::new(false);

// global shortcut suspend state
pub static SHORTCUT_SUSPEND: AtomicBool = AtomicBool::new(false);

// global registered shortcuts mapping
pub static REGISTERED_SHORTCUTS: LazyLock<Mutex<HashMap<u32, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// global Enigo instance for keyboard simulation
pub static ENIGO: LazyLock<Mutex<Result<Enigo, enigo::NewConError>>> =
    LazyLock::new(|| Mutex::new(Enigo::new(&Settings::default())));

// global ClipboardContext instance for clipboard access
pub static CLIPBOARD: LazyLock<Mutex<Result<ClipboardContext, String>>> =
    LazyLock::new(|| Mutex::new(ClipboardContext::new().map_err(|e| e.to_string())));

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, TrackingAreaOptions,
    WebviewWindowExt,
};

// define toolbar panel for macOS
#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(ToolbarPanel {
        config: {
            can_become_main_window: false,
            can_become_key_window: true,
            becomes_key_only_if_needed: true,
            is_floating_panel: true
        }
        with: {
            // enable mouse tracking for the panel
            tracking_area: {
                options: TrackingAreaOptions::new()
                    .active_always()
                    .mouse_entered_and_exited()
                    .mouse_moved()
                    .cursor_update(),
                auto_resize: true
            }
        }
    })

    panel_event!(ToolbarPanelEventHandler {})
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // register nspanel plugin on macOS
    #[cfg(target_os = "macos")]
    let builder = tauri::Builder::default().plugin(tauri_nspanel::init());
    #[cfg(not(target_os = "macos"))]
    let builder = tauri::Builder::default();

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(handle_keyboard_event)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(Target::new(TargetKind::Stdout))
                .with_colors(ColoredLevelConfig::default())
                .level(
                    // load log level from RUST_LOG env variable
                    std::env::var("RUST_LOG")
                        .ok()
                        .and_then(|level| level.parse().ok())
                        .unwrap_or(if cfg!(dev) {
                            LevelFilter::Info
                        } else {
                            LevelFilter::Off
                        }),
                )
                .build(),
        )
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            hide_main_window,
            toggle_main_window,
            goto_shortcuts,
            register_shortcut,
            unregister_shortcut,
            is_shortcut_registered,
            pause_shortcut_handling,
            resume_shortcut_handling,
            get_selection,
            get_clipboard_text,
            set_clipboard_text,
            clear_clipboard,
            execute_python,
            execute_javascript,
            enter_text,
            show_about,
            show_popup,
            show_toolbar,
            setup_tray,
            check_accessibility,
            open_accessibility,
            check_input_monitoring,
            open_input_monitoring
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(handle_run_event);
}

/// Application setup function.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.app_handle().clone();

    // store app handle globally
    if let Ok(mut handle) = APP_HANDLE.lock() {
        *handle = Some(app_handle.clone());
    }

    // start mouse event listener
    // https://github.com/Narsil/rdev/issues/165
    #[cfg(target_os = "macos")]
    rdev::set_is_main_thread(false);

    std::thread::spawn(|| {
        if let Err(error) = listen(handle_mouse_event) {
            log::error!("Error starting mouse event listener: {:?}", error);
        }
    });

    // setup system tray
    setup_tray(
        app_handle.clone(),
        "Show / Hide".to_string(),
        "Edit Shortcuts...".to_string(),
        "About TextGO".to_string(),
        "Quit".to_string(),
    )?;

    // setup main window
    setup_window(
        app,
        "main",
        Some(|_window: &WebviewWindow, app: &AppHandle| {
            // hide main window if minimizeToTray is enabled
            if let Ok(store) = app.store(".settings.dat") {
                let minimize_to_tray = store.get("minimizeToTray").and_then(|v| v.as_bool());
                if let Some(minimize_to_tray) = minimize_to_tray {
                    if minimize_to_tray {
                        hide_window(app, "main");
                    }
                }
            }
        }),
    );

    // setup toolbar window
    setup_window(
        app,
        "toolbar",
        #[allow(unused_variables)]
        Some(|window: &WebviewWindow, app: &AppHandle| {
            // convert to panel on macOS
            #[cfg(target_os = "macos")]
            {
                if let Ok(panel) = window.to_panel::<ToolbarPanel>() {
                    let handler = ToolbarPanelEventHandler::new();

                    // setup mouse hover activation
                    let app_handle = app.clone();
                    let window_label = window.label().to_string();
                    handler.on_mouse_entered(move |_event| {
                        if let Ok(panel) = app_handle.get_webview_panel(&window_label) {
                            panel.make_key_window();
                            let _ = app_handle.emit("toolbar-entered", ());
                        }
                    });

                    let app_handle = app.clone();
                    let window_label = window.label().to_string();
                    handler.on_mouse_exited(move |_event| {
                        if let Ok(panel) = app_handle.get_webview_panel(&window_label) {
                            panel.resign_key_window();
                            let _ = app_handle.emit("toolbar-exited", ());
                        }
                    });

                    // set the window to float level
                    panel.set_level(PanelLevel::Floating.value());

                    // prevent app activation when clicked
                    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

                    // allow display over fullscreen windows and on all spaces
                    panel.set_collection_behavior(
                        CollectionBehavior::new()
                            .full_screen_auxiliary()
                            .can_join_all_spaces()
                            .into(),
                    );

                    // don't hide when app deactivates
                    panel.set_hides_on_deactivate(false);

                    // receive keyboard and mouse events even
                    // when another window in the application is running modally
                    panel.set_works_when_modal(true);

                    // attach the event handler
                    panel.set_event_handler(Some(handler.as_ref()));
                }
            }
        }),
    );

    // setup popup window
    setup_window(app, "popup", None::<fn(&WebviewWindow, &AppHandle)>);

    Ok(())
}

/// Setup window to hide on close instead of quitting, with optional configuration.
fn setup_window<F>(app: &App, label: &str, configure: Option<F>) -> Option<()>
where
    F: FnOnce(&WebviewWindow, &AppHandle) + 'static,
{
    let window = app.get_webview_window(label)?;
    let app_handle = window.app_handle().clone();

    // execute optional configuration closure
    if let Some(configure) = configure {
        configure(&window, &app_handle);
    }

    // setup hide on close behavior
    let label = label.to_string();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide_window(&app_handle, &label);
            // emit window hide event
            let hide_event = format!("hide-{}", label);
            let _ = app_handle.emit(&hide_event, ());
        }
    });

    Some(())
}

/// Runtime event handler function.
#[allow(unused_variables)]
fn handle_run_event(app: &AppHandle, event: RunEvent) {
    // handle Reopen event on macOS
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        // show main window when no visible windows
        show_window(app, "main");
        // also show dock icon
        let _ = app.set_dock_visibility(true);
    }
}
