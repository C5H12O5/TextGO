//! Initial Linux backend: X11 shortcuts and the shared clipboard fallback.
use crate::error::AppError;
use std::path::Path;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, Window};
use x11rb::rust_connection::RustConnection;

pub type FocusTarget = Window;

pub fn check_session() -> Result<(), AppError> {
    if std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session == "wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        return Err("TextGO currently requires an X11 session; Wayland is not supported".into());
    }
    connect().map(|_| ())
}

fn connect() -> Result<(RustConnection, usize), AppError> {
    x11rb::connect(None).map_err(|error| format!("Cannot connect to X11: {error}").into())
}

fn property(window: Window, name: &[u8], kind: AtomEnum) -> Option<u32> {
    let (connection, _) = connect().ok()?;
    let atom = connection.intern_atom(false, name).ok()?.reply().ok()?.atom;
    let value = connection
        .get_property(false, window, atom, kind, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next();
    value
}

pub fn get_focus_target() -> Option<FocusTarget> {
    let (connection, screen) = connect().ok()?;
    property(
        connection.setup().roots[screen].root,
        b"_NET_ACTIVE_WINDOW",
        AtomEnum::WINDOW,
    )
    .filter(|window| *window != 0)
}

pub fn activate_focus_target(target: FocusTarget) -> Result<(), AppError> {
    let (connection, screen) = connect()?;
    let activate = || -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let atom = connection
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")?
            .reply()?
            .atom;
        // EWMH source 2 identifies a pager-like utility. The window manager decides focus.
        let event = ClientMessageEvent::new(32, target, atom, [2, 0, 0, 0, 0]);
        connection
            .send_event(
                false,
                connection.setup().roots[screen].root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            )?
            .check()?;
        connection.flush()?;
        Ok(())
    };
    activate().map_err(AppError::from)
}

pub fn is_focus_target_active(target: FocusTarget) -> bool {
    get_focus_target() == Some(target)
}

pub fn get_selection() -> Result<String, AppError> {
    Err("Linux uses the clipboard fallback to read the current selection".into())
}

pub fn get_cursor_location() -> Result<(i32, i32), AppError> {
    // Let the caller use Enigo's pointer position in physical X11 pixels.
    Err("Selection bounds are unavailable on Linux".into())
}

pub fn is_cursor_editable() -> Result<bool, AppError> {
    // Do not guess editability and move the caret in an unrelated control.
    Ok(false)
}

pub fn is_ibeam_cursor() -> bool {
    // ponytail: automatic mouse triggers are opt-in until cursor detection is implemented.
    false
}

pub fn select_backward_chars(_chars: usize) -> Result<(), AppError> {
    Err("Native text reselection is unavailable on Linux".into())
}

pub fn get_app_id(app_path: &Path) -> Result<String, AppError> {
    Ok(std::fs::canonicalize(app_path)?
        .to_string_lossy()
        .into_owned())
}

pub fn get_frontmost_app_id() -> Option<String> {
    let pid = property(get_focus_target()?, b"_NET_WM_PID", AtomEnum::CARDINAL)?;
    std::fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

pub fn get_frontmost_url() -> Option<String> {
    None
}

#[cfg(test)]
#[test]
fn unsupported_accessibility_does_not_claim_success() {
    assert!(get_selection().is_err());
    assert!(get_cursor_location().is_err());
    assert!(!is_cursor_editable().unwrap());
    assert!(!is_ibeam_cursor());
    assert!(select_backward_chars(1).is_err());
    assert!(get_frontmost_url().is_none());
}

#[cfg(test)]
#[test]
fn linux_frontend_capabilities_are_enabled() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    assert!(capability["platforms"]
        .as_array()
        .unwrap()
        .iter()
        .any(|platform| platform == "linux"));
}
