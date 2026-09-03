use crate::{error::AppError, SETTINGS_STORE};
use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;

const DEFAULT_LOCALE: &str = "en";
const ZH_CN_LOCALE: &str = "zh-CN";
const EN_MESSAGES: &str = include_str!("../../../messages/en.json");
const ZH_CN_MESSAGES: &str = include_str!("../../../messages/zh-CN.json");

#[derive(Deserialize)]
struct TrayLabels {
    tray_main_window: String,
    tray_shortcuts: String,
    tray_history: String,
    tray_settings: String,
    tray_quit: String,
}

pub(crate) struct TrayMenu(Menu<tauri::Wry>);

fn resolve_locale(saved: Option<&str>, system: Option<&str>) -> &'static str {
    saved
        .and_then(supported_locale)
        .or_else(|| system.and_then(supported_locale))
        .unwrap_or(DEFAULT_LOCALE)
}

fn supported_locale(locale: &str) -> Option<&'static str> {
    if locale.eq_ignore_ascii_case(ZH_CN_LOCALE) {
        Some(ZH_CN_LOCALE)
    } else if locale.eq_ignore_ascii_case(DEFAULT_LOCALE) {
        Some(DEFAULT_LOCALE)
    } else {
        None
    }
}

fn load_tray_labels(locale: &str) -> Result<TrayLabels, AppError> {
    let messages = if locale == ZH_CN_LOCALE {
        ZH_CN_MESSAGES
    } else {
        EN_MESSAGES
    };
    Ok(serde_json::from_str(messages)?)
}

/// Initialize the tray with the saved application locale.
pub fn initialize_tray(app: &AppHandle) -> Result<(), AppError> {
    let store = app.store(SETTINGS_STORE)?;
    let saved_locale = store
        .get("locale")
        .and_then(|value| value.as_str().map(str::to_owned));
    let system_locale = tauri_plugin_os::locale();
    let locale = resolve_locale(saved_locale.as_deref(), system_locale.as_deref());
    let labels = load_tray_labels(locale)?;

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(
                app,
                "main_window",
                labels.tray_main_window,
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "shortcuts", labels.tray_shortcuts, true, None::<&str>)?,
            &MenuItem::with_id(app, "history", labels.tray_history, true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "settings",
                labels.tray_settings,
                true,
                Some("CmdOrCtrl+,"),
            )?,
            // about
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "about",
                format!("v{}", app.package_info().version),
                false,
                None::<&str>,
            )?,
            // quit
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", labels.tray_quit, true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .show_menu_on_left_click(cfg!(not(target_os = "windows")))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "main_window" => {
                crate::commands::show_main_window(app.clone());
            }
            "shortcuts" => {
                crate::commands::navigate_to(app.clone(), "/shortcuts".to_string());
            }
            "history" => {
                crate::commands::navigate_to(app.clone(), "/history".to_string());
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
        });

    // on Windows, left click shows main window instead of opening the menu
    #[cfg(target_os = "windows")]
    let builder = builder.on_tray_icon_event(|tray, event| {
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            crate::commands::show_main_window(tray.app_handle().clone());
        }
    });

    let _tray = builder.build(app)?;
    app.manage(TrayMenu(menu));

    Ok(())
}

/// Persist the application locale and update existing tray menu items in place.
#[tauri::command]
pub fn set_tray_locale(
    app: AppHandle,
    menu: State<'_, TrayMenu>,
    locale: String,
) -> Result<(), AppError> {
    let locale = supported_locale(&locale)
        .ok_or_else(|| AppError::from(format!("Unsupported locale: {locale}")))?;
    let labels = load_tray_labels(locale)?;

    for (id, text) in [
        ("main_window", labels.tray_main_window),
        ("shortcuts", labels.tray_shortcuts),
        ("history", labels.tray_history),
        ("settings", labels.tray_settings),
        ("quit", labels.tray_quit),
    ] {
        let item = menu
            .0
            .get(id)
            .ok_or_else(|| AppError::from(format!("Tray menu item not found: {id}")))?;
        item.as_menuitem()
            .ok_or_else(|| AppError::from(format!("Invalid tray menu item: {id}")))?
            .set_text(text)?;
    }

    let store = app.store(SETTINGS_STORE)?;
    store.set("locale", locale);
    store.save()?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_locale_takes_priority_over_system_locale() {
        assert_eq!(resolve_locale(Some("zh-CN"), Some("en-US")), "zh-CN");
    }

    #[test]
    fn system_locale_is_used_when_saved_locale_is_missing() {
        assert_eq!(resolve_locale(None, Some("zh-CN")), "zh-CN");
    }

    #[test]
    fn tray_labels_are_loaded_from_the_selected_message_file() {
        let labels = load_tray_labels("zh-CN").unwrap();

        assert_eq!(labels.tray_main_window, "打开 TextGO");
        assert_eq!(labels.tray_shortcuts, "管理快捷键");
        assert_eq!(labels.tray_history, "查看历史");
        assert_eq!(labels.tray_settings, "设置...");
        assert_eq!(labels.tray_quit, "退出");
    }
}
