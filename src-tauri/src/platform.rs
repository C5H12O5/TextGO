#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{get_cursor_location, get_selection, is_cursor_editable, select_backward_chars};
#[cfg(target_os = "windows")]
pub use windows::{get_cursor_location, get_selection, is_cursor_editable, select_backward_chars};
