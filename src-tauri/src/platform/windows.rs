use crate::error::AppError;
use windows::core::Interface;
use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationLegacyIAccessiblePattern,
    IUIAutomationTextPattern, IUIAutomationTextRange, IUIAutomationTreeWalker,
    IUIAutomationValuePattern, TextPatternRangeEndpoint_Start, TextUnit_Character,
    UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_LegacyIAccessiblePatternId, UIA_TextPatternId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorInfo, GetCursorPos, LoadCursorW, CURSORINFO, CURSOR_SHOWING, IDC_IBEAM,
};

// bounds validation constants
const MIN_VALID_WIDTH: f64 = 1.0;
const MAX_VALID_HEIGHT: f64 = 100.0;
const MAX_VALID_COORDINATE: f64 = 10000.0;

// editable legacy control roles
const ROLE_SYSTEM_TEXT: u32 = 42;
const ROLE_SYSTEM_COMBOBOX: u32 = 46;

// maximum depth to search for a parent element supporting TextPattern
const MAX_TEXT_PATTERN_PARENT_DEPTH: usize = 10;

// import SafeArray functions from oleaut32.dll
#[link(name = "oleaut32")]
unsafe extern "system" {
    unsafe fn SafeArrayAccessData(
        psa: *mut std::ffi::c_void,
        ppv_data: *mut *mut std::ffi::c_void,
    ) -> i32;

    unsafe fn SafeArrayUnaccessData(psa: *mut std::ffi::c_void) -> i32;

    unsafe fn SafeArrayGetLBound(
        psa: *mut std::ffi::c_void,
        n_dim: u32,
        pl_lbound: *mut i32,
    ) -> i32;

    unsafe fn SafeArrayGetUBound(
        psa: *mut std::ffi::c_void,
        n_dim: u32,
        pl_ubound: *mut i32,
    ) -> i32;
}

/// COM resource guard.
struct ComGuard {
    initialized: bool,
}

impl ComGuard {
    /// Initialize COM environment.
    fn new() -> Result<Self, AppError> {
        unsafe {
            let result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if result.is_ok() {
                // successfully initialized, need to release on drop
                Ok(ComGuard { initialized: true })
            } else if result == windows::Win32::Foundation::RPC_E_CHANGED_MODE {
                // COM already initialized by other code, no need to release
                Ok(ComGuard { initialized: false })
            } else {
                // other errors
                Err("Failed to initialize COM".into())
            }
        }
    }
}

impl Drop for ComGuard {
    /// Release COM resources.
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

/// Create UI Automation instance.
fn create_automation() -> Result<IUIAutomation, AppError> {
    unsafe {
        CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create UI Automation instance: {}", e).into())
    }
}

fn get_focused_element(automation: &IUIAutomation) -> windows::core::Result<IUIAutomationElement> {
    unsafe { automation.GetFocusedElement() }
}

fn get_cursor_point() -> Option<POINT> {
    unsafe {
        let mut point = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut point).is_ok() {
            Some(point)
        } else {
            None
        }
    }
}

fn get_element_from_cursor(
    automation: &IUIAutomation,
) -> windows::core::Result<Option<IUIAutomationElement>> {
    unsafe {
        let Some(point) = get_cursor_point() else {
            return Ok(None);
        };

        automation.ElementFromPoint(point).map(Some)
    }
}

fn try_get_selected_range(
    element: &IUIAutomationElement,
) -> windows::core::Result<Option<IUIAutomationTextRange>> {
    unsafe {
        let Ok(text_pattern) = element
            .GetCurrentPattern(UIA_TextPatternId)
            .and_then(|p| p.cast::<IUIAutomationTextPattern>())
        else {
            return Ok(None);
        };

        let Ok(text_ranges) = text_pattern.GetSelection() else {
            return Ok(None);
        };

        if text_ranges.Length().unwrap_or(0) == 0 {
            return Ok(None);
        }

        text_ranges.GetElement(0).map(Some)
    }
}

fn find_selected_range(
    automation: &IUIAutomation,
    start: &IUIAutomationElement,
) -> windows::core::Result<Option<IUIAutomationTextRange>> {
    unsafe {
        let walker: IUIAutomationTreeWalker = automation.ControlViewWalker()?;
        let mut current = start.clone();

        for _ in 0..=MAX_TEXT_PATTERN_PARENT_DEPTH {
            if let Some(range) = try_get_selected_range(&current)? {
                return Ok(Some(range));
            }

            let Ok(parent) = walker.GetParentElement(&current) else {
                break;
            };
            current = parent;
        }

        Ok(None)
    }
}

/// Get selected text in currently focused element (best-effort, does not simulate input).
pub fn get_selection() -> Result<String, AppError> {
    unsafe {
        // initialize COM
        let _com = ComGuard::new()?;
        let automation = create_automation()?;

        let mut candidates: Vec<IUIAutomationElement> = Vec::with_capacity(2);
        if let Ok(focused) = get_focused_element(&automation) {
            candidates.push(focused);
        }
        if let Ok(Some(element)) = get_element_from_cursor(&automation) {
            candidates.push(element);
        }

        for element in candidates {
            let Ok(Some(text_range)) = find_selected_range(&automation, &element) else {
                continue;
            };

            let Ok(text) = text_range.GetText(-1) else {
                continue;
            };

            let text = text.to_string();
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }

        Ok(String::new())
    }
}

/// Get the coordinates of the bottom-right corner of the selected text.
pub fn get_cursor_location() -> Result<(i32, i32), AppError> {
    unsafe {
        // initialize COM
        let _com = ComGuard::new()?;

        let fallback = get_cursor_point()
            .map(|p| (p.x, p.y))
            .ok_or_else(|| AppError::from("Failed to get cursor position"))?;

        let automation = create_automation()?;

        let mut candidates: Vec<IUIAutomationElement> = Vec::with_capacity(2);
        if let Ok(focused) = get_focused_element(&automation) {
            candidates.push(focused);
        }
        if let Ok(Some(element)) = get_element_from_cursor(&automation) {
            candidates.push(element);
        }

        let mut text_range: Option<IUIAutomationTextRange> = None;
        for element in candidates {
            if let Ok(Some(range)) = find_selected_range(&automation, &element) {
                text_range = Some(range);
                break;
            }
        }

        let Some(text_range) = text_range else {
            return Ok(fallback);
        };

        // get bounding rectangles for the text range
        let Ok(rect_array) = text_range.GetBoundingRectangles() else {
            return Ok(fallback);
        };

        // access the SafeArray data
        let mut rect_ptr: *mut f64 = std::ptr::null_mut();
        let hr = SafeArrayAccessData(rect_array as *mut _, &mut rect_ptr as *mut _ as *mut _);
        if hr != 0 {
            return Ok(fallback);
        }

        // get array bounds
        let mut lower_bound: i32 = 0;
        let mut upper_bound: i32 = 0;
        let hr = SafeArrayGetLBound(rect_array as *mut _, 1, &mut lower_bound);
        if hr != 0 {
            SafeArrayUnaccessData(rect_array as *mut _);
            return Ok(fallback);
        }
        let hr = SafeArrayGetUBound(rect_array as *mut _, 1, &mut upper_bound);
        if hr != 0 {
            SafeArrayUnaccessData(rect_array as *mut _);
            return Ok(fallback);
        }

        let rect_count = ((upper_bound - lower_bound + 1) / 4) as usize;
        if rect_count == 0 {
            SafeArrayUnaccessData(rect_array as *mut _);
            return Ok(fallback);
        }

        // find last valid rectangle and calculate coordinates
        let mut result: Option<(i32, i32)> = None;
        for i in (0..rect_count).rev() {
            let rect_index = i * 4;
            let left = *rect_ptr.add(rect_index);
            let top = *rect_ptr.add(rect_index + 1);
            let width = *rect_ptr.add(rect_index + 2);
            let height = *rect_ptr.add(rect_index + 3);

            // validate rectangle bounds
            if width > MIN_VALID_WIDTH
                && height > 0.0
                && height < MAX_VALID_HEIGHT
                && left >= 0.0
                && top >= 0.0
                && left < MAX_VALID_COORDINATE
                && top < MAX_VALID_COORDINATE
            {
                // calculate bottom-right corner coordinates
                let bottom_right_x = (left + width) as i32;
                let bottom_right_y = (top + height) as i32;
                result = Some((bottom_right_x, bottom_right_y));
                break;
            }
        }

        // unaccess the SafeArray data
        SafeArrayUnaccessData(rect_array as *mut _);

        Ok(result.unwrap_or(fallback))
    }
}

/// Check if currently focused element is editable.
pub fn is_cursor_editable() -> Result<bool, AppError> {
    unsafe {
        // initialize COM
        let _com = ComGuard::new()?;

        let automation = create_automation()?;

        // get focused element
        let focused_element = get_focused_element(&automation)
            .map_err(|e| format!("Failed to get focused element: {}", e))?;

        // 1. check if control type is editable
        if let Ok(control_type) = focused_element.CurrentControlType() {
            let is_edit_control = control_type.0 == UIA_EditControlTypeId.0;
            let is_document_control = control_type.0 == UIA_DocumentControlTypeId.0;
            if is_edit_control || is_document_control {
                return Ok(true);
            }
        }

        // 2. check if value pattern is not read-only
        if let Ok(is_readonly) = focused_element
            .GetCurrentPattern(UIA_ValuePatternId)
            .and_then(|p| p.cast::<IUIAutomationValuePattern>())
            .and_then(|vp| vp.CurrentIsReadOnly())
        {
            if !is_readonly.as_bool() {
                return Ok(true);
            }
        }

        // 3. check if legacy control role is editable
        if let Ok(role) = focused_element
            .GetCurrentPattern(UIA_LegacyIAccessiblePatternId)
            .and_then(|p| p.cast::<IUIAutomationLegacyIAccessiblePattern>())
            .and_then(|lp| lp.CurrentRole())
        {
            if role == ROLE_SYSTEM_TEXT || role == ROLE_SYSTEM_COMBOBOX {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

/// Check if current cursor is I-Beam (text cursor).
pub fn is_ibeam_cursor() -> bool {
    unsafe {
        let mut cursor_info = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            flags: Default::default(),
            hCursor: Default::default(),
            ptScreenPos: Default::default(),
        };

        // get current cursor information
        if GetCursorInfo(&mut cursor_info).is_err() {
            return false;
        }

        // check if cursor is showing
        if cursor_info.flags != CURSOR_SHOWING {
            return false;
        }

        // load the system I-Beam cursor to get its handle
        let Ok(ibeam_cursor) = LoadCursorW(None, IDC_IBEAM) else {
            return false;
        };

        // compare cursor handles
        cursor_info.hCursor == ibeam_cursor
    }
}

/// Select specified number of characters from current cursor position backward.
pub fn select_backward_chars(chars: usize) -> Result<(), AppError> {
    unsafe {
        // initialize COM
        let _com = ComGuard::new()?;

        let automation = create_automation()?;
        let focused_element = get_focused_element(&automation)
            .map_err(|e| format!("Failed to get focused element: {}", e))?;

        let text_range = find_selected_range(&automation, &focused_element)
            .map_err(|e| format!("Failed to get text selection: {}", e))?
            .ok_or_else(|| AppError::from("No text selection found"))?;

        // move endpoint backward
        text_range
            .MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -(chars as i32),
            )
            .map_err(|_| "Failed to move endpoint backward")?;

        // select new range
        text_range
            .Select()
            .map_err(|_| "Failed to select new range")?;

        Ok(())
    }
}
