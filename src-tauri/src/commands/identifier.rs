use crate::error::AppError;
use crate::platform;
use crate::SETTINGS_STORE;
use log::debug;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use wildmatch::WildMatch;

/// Get application identifier from an application path.
/// - On macOS: Returns the bundle identifier (e.g., "com.apple.Safari")
/// - On Windows: Returns the normalized executable path (e.g., "C:\\Program Files\\App\\app.exe")
#[tauri::command]
pub fn get_app_id(app_path: String) -> Result<String, AppError> {
    platform::get_app_id(&PathBuf::from(app_path))
}

/// Check if the current frontmost application or website is in the blacklist.
/// Returns true if any blacklist rule matches, false otherwise.
#[tauri::command]
pub fn is_blocked(app: AppHandle) -> Result<bool, AppError> {
    // get blacklist from settings store
    let blacklist: Vec<String> = app
        .store(SETTINGS_STORE)?
        .get("blacklist")
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_default();

    // return false if blacklist is empty
    if blacklist.is_empty() {
        return Ok(false);
    }

    // separate website rules and app rules
    let (website_rules, app_rules): (Vec<_>, Vec<_>) =
        blacklist.iter().partition(|rule| is_website_rule(rule));

    // check app rules if any
    if !app_rules.is_empty() {
        if let Some(app_id) = platform::get_frontmost_app_id() {
            debug!("Checking application blacklist for app_id: {}", app_id);
            for rule in app_rules {
                if matches_wildcard(rule, &app_id) {
                    debug!("Application blocked by rule: {}", rule);
                    return Ok(true);
                }
            }
        }
    }

    // check website rules if any
    if !website_rules.is_empty() {
        if let Some(url) = platform::get_frontmost_url() {
            debug!("Checking website blacklist for url: {}", url);
            for rule in website_rules {
                if matches_wildcard(rule.trim_end_matches('/'), url.trim_end_matches('/')) {
                    debug!("Website blocked by rule: {}", rule);
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

/// Check if a rule is for websites (starts with http:// or https://).
fn is_website_rule(rule: &str) -> bool {
    let lower = rule.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Match a input string against a wildcard pattern.
fn matches_wildcard(pattern: &str, input: &str) -> bool {
    WildMatch::new_case_insensitive(pattern).matches(input)
}
