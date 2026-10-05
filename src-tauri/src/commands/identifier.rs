use crate::error::AppError;
use crate::platform;
use crate::SETTINGS_STORE;
use log::debug;
use serde_json::Value;
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
    Ok(get_frontmost_context(app.store(SETTINGS_STORE)?.get("blacklist"), || false).blocked)
}

/// Blacklist decision and optional identifier for the frontmost application.
pub struct FrontmostContext {
    pub blocked: bool,
    /// Empty when the identifier was not needed or could not be obtained.
    pub app_id: String,
}

/// Reuse the blacklist's application lookup when its identifier is also needed.
pub(super) fn get_frontmost_context(
    blacklist: Option<Value>,
    needs_app_id: impl FnOnce() -> bool,
) -> FrontmostContext {
    let blacklist = read_blacklist(blacklist);
    check_frontmost_context(
        &blacklist,
        needs_app_id,
        platform::get_frontmost_app_id,
        platform::get_frontmost_url,
    )
}

fn read_blacklist(value: Option<Value>) -> Vec<String> {
    value
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_default()
}

fn check_frontmost_context(
    blacklist: &[String],
    needs_app_id: impl FnOnce() -> bool,
    get_app_id: impl Fn() -> Option<String>,
    get_url: impl FnOnce() -> Option<String>,
) -> FrontmostContext {
    // separate website rules and app rules
    let (website_rules, app_rules): (Vec<_>, Vec<_>) =
        blacklist.iter().partition(|rule| is_website_rule(rule));

    let mut app_id = if app_rules.is_empty() {
        None
    } else {
        get_app_id()
    };
    let blocked_by_app = app_id.as_ref().is_some_and(|app_id| {
        debug!("Checking application blacklist for app_id: {}", app_id);
        app_rules.iter().any(|rule| {
            if matches_wildcard(rule, app_id) {
                debug!("Application blocked by rule: {}", rule);
                return true;
            }
            false
        })
    });

    // Preserve application-first matching and skip further work after a block.
    let blocked = blocked_by_app
        || (!website_rules.is_empty()
            && get_url().is_some_and(|url| {
                debug!("Checking website blacklist for url: {}", url);
                website_rules.iter().any(|rule| {
                    if matches_wildcard(rule.trim_end_matches('/'), url.trim_end_matches('/')) {
                        debug!("Website blocked by rule: {}", rule);
                        return true;
                    }
                    false
                })
            }));

    // Application rules already attempted the lookup; do not retry even if it failed.
    if !blocked && app_rules.is_empty() && needs_app_id() {
        app_id = get_app_id();
    }

    FrontmostContext {
        blocked,
        app_id: app_id.unwrap_or_default(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn empty_blacklists_only_fetch_app_id_when_requested() {
        for needs_app_id in [false, true] {
            let calls = Cell::new(0);
            let context = check_frontmost_context(
                &[],
                || needs_app_id,
                || {
                    calls.set(calls.get() + 1);
                    Some("com.apple.Safari".to_string())
                },
                || panic!("No website blacklist requires a URL lookup"),
            );
            assert_eq!(calls.get(), usize::from(needs_app_id));
            assert!(!context.blocked);
            assert_eq!(context.app_id.is_empty(), !needs_app_id);
        }
    }

    #[test]
    fn application_blacklist_lookup_is_reused_even_when_identification_fails() {
        for source in [Some("com.apple.Safari".to_string()), None] {
            let calls = Cell::new(0);
            let context = check_frontmost_context(
                &["com.example.blocked".to_string()],
                || panic!("An existing blacklist lookup makes identifier requests unnecessary"),
                || {
                    calls.set(calls.get() + 1);
                    source.clone()
                },
                || panic!("No website rules"),
            );
            assert!(!context.blocked);
            assert_eq!(context.app_id, source.unwrap_or_default());
            assert_eq!(calls.get(), 1);
        }
    }

    #[test]
    fn blocked_applications_skip_website_and_identifier_requests() {
        let context = check_frontmost_context(
            &[
                "COM.APPLE.*".to_string(),
                "https://example.com/*".to_string(),
            ],
            || panic!("Blocked applications must skip identifier requests"),
            || Some("com.apple.Safari".to_string()),
            || panic!("An application blacklist match must skip website lookup"),
        );
        assert!(context.blocked);
    }

    #[test]
    fn website_blacklists_only_fetch_app_id_when_unblocked_and_requested() {
        for (url, needs_app_id, expected_calls, blocked) in [
            ("https://blocked.example/", true, 0, true),
            ("https://allowed.example/", false, 0, false),
            ("https://allowed.example/", true, 1, false),
        ] {
            let calls = Cell::new(0);
            let context = check_frontmost_context(
                &["HTTPS://BLOCKED.EXAMPLE".to_string()],
                || {
                    assert!(!blocked, "Blocked websites must skip identifier requests");
                    needs_app_id
                },
                || {
                    calls.set(calls.get() + 1);
                    Some("com.apple.Safari".to_string())
                },
                || Some(url.to_string()),
            );
            assert_eq!(context.blocked, blocked);
            assert_eq!(calls.get(), expected_calls);
        }
    }

    #[test]
    fn combined_blacklists_share_one_lookup_and_keep_website_matching() {
        let calls = Cell::new(0);
        let context = check_frontmost_context(
            &[
                "com.example.blocked".to_string(),
                "https://blocked.example/*".to_string(),
            ],
            || panic!("Blocked websites must skip identifier requests"),
            || {
                calls.set(calls.get() + 1);
                Some("com.apple.Safari".to_string())
            },
            || Some("https://blocked.example/page".to_string()),
        );
        assert!(context.blocked);
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn application_identifiers_are_not_reused_between_triggers() {
        for app_id in ["com.apple.Safari", "com.apple.TextEdit"] {
            let context = check_frontmost_context(
                &[],
                || true,
                || Some(app_id.to_string()),
                || panic!("No website rules"),
            );
            assert!(!context.blocked);
            assert_eq!(context.app_id, app_id);
        }
    }
}
