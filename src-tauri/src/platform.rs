#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{
    get_app_id, get_cursor_location, get_frontmost_app_id, get_frontmost_url, get_selection,
    is_cursor_editable, is_ibeam_cursor, select_backward_chars,
};
#[cfg(target_os = "windows")]
pub use windows::{
    get_app_id, get_cursor_location, get_frontmost_app_id, get_frontmost_url, get_selection,
    is_cursor_editable, is_ibeam_cursor, select_backward_chars,
};
