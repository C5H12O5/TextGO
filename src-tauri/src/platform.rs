#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{
    activate_focus_target, get_app_id, get_cursor_location, get_focus_target, get_frontmost_app_id,
    get_frontmost_url, get_selection, is_cursor_editable, is_focus_target_active, is_ibeam_cursor,
    select_backward_chars, FocusTarget,
};
#[cfg(target_os = "windows")]
pub use windows::{
    activate_focus_target, get_app_id, get_cursor_location, get_focus_target, get_frontmost_app_id,
    get_frontmost_url, get_selection, get_text_scale_factor, is_cursor_editable,
    is_focus_target_active, is_ibeam_cursor, select_backward_chars, FocusTarget,
};
