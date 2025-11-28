mod commands;
mod error;
mod platform;

use commands::*;
use enigo::{Enigo, Settings};
use fern::colors::ColoredLevelConfig;
use log::LevelFilter;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, TrackingAreaOptions,
    WebviewWindowExt,
};

// Define toolbar panel for macOS
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

// global, shared Enigo wrapped in a Mutex
// the Enigo struct should be created once and then reused for efficiency
pub static ENIGO: LazyLock<Mutex<Result<Enigo, enigo::NewConError>>> =
    LazyLock::new(|| Mutex::new(Enigo::new(&Settings::default())));

// global registered shortcuts mapping
pub static REGISTERED_SHORTCUTS: LazyLock<Mutex<HashMap<u32, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// global flag to pause shortcut event processing
pub static SHORTCUT_PAUSED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

/// Application setup function.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.app_handle().clone();

    // initialize tray menu
    setup_tray(
        app_handle.clone(),
        "Show / Hide".to_string(),
        "Edit Shortcuts...".to_string(),
        "About TextGO".to_string(),
        "Quit".to_string(),
    )
    .ok();

    // get main window and set close behavior
    if let Some(window) = app.get_webview_window("main") {
        let app_handle = window.app_handle().clone();

        // hide window if minimizeToTray is enabled
        if let Ok(store) = app_handle.store(".settings.dat") {
            if let Some(minimize_to_tray) = store.get("minimizeToTray").and_then(|v| v.as_bool()) {
                if minimize_to_tray {
                    hide_window(&app_handle, "main");
                }
            }
        }

        // hide main window on close instead of quitting
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_window(&app_handle, "main");
            }
        });
    }

    // get popup window and set close behavior
    if let Some(window) = app.get_webview_window("popup") {
        let app_handle = window.app_handle().clone();

        // hide popup window on close instead of quitting
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_window(&app_handle, "popup");
            }
        });
    }

    // get toolbar window and set close behavior
    if let Some(window) = app.get_webview_window("toolbar") {
        let app_handle = window.app_handle().clone();

        // convert to panel on macOS
        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = window.to_panel::<ToolbarPanel>() {
                let handler = ToolbarPanelEventHandler::new();

                // setup mouse hover activation
                let handle = app_handle.clone();
                handler.on_mouse_entered(move |_event| {
                    if let Ok(panel) = handle.get_webview_panel("toolbar") {
                        panel.make_key_window();
                    }
                });

                let handle = app_handle.clone();
                handler.on_mouse_exited(move |_event| {
                    if let Ok(panel) = handle.get_webview_panel("toolbar") {
                        panel.resign_key_window();
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

        // hide toolbar window on close instead of quitting
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_window(&app_handle, "toolbar");
            }
        });
    }

    Ok(())
}

/// Runtime event handler function.
#[allow(unused_variables)]
fn handle_run_event(app: &tauri::AppHandle, event: RunEvent) {
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

/// Global shortcut handler function.
fn handle_shortcut_event(app: &tauri::AppHandle, hotkey: &Shortcut, event: ShortcutEvent) {
    if event.state() == ShortcutState::Pressed {
        // check if shortcut processing is paused
        if let Ok(paused) = SHORTCUT_PAUSED.lock() {
            if *paused {
                return;
            }
        }

        // get shortcut string
        let shortcut = {
            let registered = REGISTERED_SHORTCUTS.lock().unwrap();
            registered
                .get(&hotkey.id)
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string())
        };

        // clone app and shortcut for async move
        let app_clone = app.clone();
        let shortcut_clone = shortcut.clone();

        // asynchronously get selected text and emit event to frontend
        tauri::async_runtime::spawn(async move {
            if let Ok(selection) = get_selection(app_clone.clone()).await {
                let event_data = serde_json::json!({
                    "shortcut": shortcut_clone,
                    "selection": selection
                });
                let _ = app_clone.emit("shortcut-triggered", event_data);
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // register nspanel plugin on macOS
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(handle_shortcut_event)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(Target::new(TargetKind::Stdout))
                .with_colors(ColoredLevelConfig::default())
                .level(if cfg!(dev) {
                    LevelFilter::Info
                } else {
                    LevelFilter::Off
                })
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
            execute_python,
            execute_javascript,
            enter_text,
            show_about,
            show_popup,
            show_toolbar,
            setup_tray,
            check_accessibility,
            open_accessibility
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(handle_run_event);
}
