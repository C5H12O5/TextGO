#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{
    activate_focus_target, get_app_id, get_cursor_location, get_focus_target, get_frontmost_app_id,
    get_frontmost_url, get_paste_anchor, get_selection, is_focus_target_active,
    is_focus_target_ready, is_ibeam_cursor, select_pasted_text, FocusTarget, PasteAnchor,
};
#[cfg(target_os = "windows")]
pub use windows::{
    activate_focus_target, get_app_id, get_cursor_location, get_focus_target, get_frontmost_app_id,
    get_frontmost_url, get_paste_anchor, get_selection, get_text_scale_factor,
    is_focus_target_active, is_focus_target_ready, is_ibeam_cursor, select_pasted_text,
    FocusTarget, PasteAnchor,
};

/// Progress of a paste into the focused text element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasteProgress {
    /// The element still reports the selection captured before the paste.
    Pending,
    /// The pasted text has been selected.
    Selected,
    /// The paste has landed, but the element rejected the new selection.
    Unselectable,
}
