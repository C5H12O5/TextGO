use crate::error::AppError;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

/// Initialize or update tray menu.
#[tauri::command]
pub fn setup_tray(
    app: AppHandle,
    main_window_text: String,
    shortcuts_text: String,
    histories_text: String,
    settings_text: String,
    about_text: String,
    quit_text: String,
) -> Result<(), AppError> {
    // create new menu
    let menu = Menu::with_items(
        &app,
        &[
            &MenuItem::with_id(&app, "main_window", main_window_text, true, None::<&str>)?,
            &PredefinedMenuItem::separator(&app)?,
            &MenuItem::with_id(&app, "shortcuts", shortcuts_text, true, None::<&str>)?,
            &MenuItem::with_id(&app, "histories", histories_text, true, None::<&str>)?,
            &MenuItem::with_id(&app, "settings", settings_text, true, Some("CmdOrCtrl+,"))?,
            // about
            &PredefinedMenuItem::separator(&app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::about(&app, Some(&about_text), None)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(&app, "about", about_text, true, None::<&str>)?,
            // quit
            &PredefinedMenuItem::separator(&app)?,
            &MenuItem::with_id(&app, "quit", quit_text, true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    // try to get existing tray menu and update it
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu))?;
    } else {
        // create new tray menu if getting fails
        let _tray = TrayIconBuilder::with_id("main-tray")
            .menu(&menu)
            .icon(app.default_window_icon().unwrap().clone())
            .icon_as_template(true)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "main_window" => {
                    crate::commands::show_main_window(app.clone());
                }
                "shortcuts" => {
                    crate::commands::navigate_to(app.clone(), "/shortcuts".to_string());
                }
                "histories" => {
                    crate::commands::navigate_to(app.clone(), "/histories".to_string());
                }
                "settings" => {
                    crate::commands::navigate_to(app.clone(), "/settings".to_string());
                }
                "about" => {
                    show_about(app.clone());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .build(&app)?;
    }

    Ok(())
}

/// Show about dialog.
#[tauri::command]
pub fn show_about(app: AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    // get application information
    let package_info = app.package_info();
    // use dialog plugin to show message box
    app.dialog()
        .message(format!("Version {}", package_info.version))
        .title(package_info.name.clone())
        .kind(MessageDialogKind::Info)
        .blocking_show();
}
