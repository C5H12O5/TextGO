use crate::error::AppError;
use core_foundation::array::CFArray;
use core_foundation::base::{CFRange, CFType, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use std::os::raw::c_void;

// bounds validation constants
const MIN_VALID_WIDTH: f64 = 1.0;
const MAX_VALID_HEIGHT: f64 = 100.0;
const MAX_VALID_COORDINATE: f64 = 10000.0;

// editable accessibility roles
const EDITABLE_AX_ROLES: &[&str] = &["AXTextField", "AXTextArea", "AXComboBox"];

// AXValueType constant
// https://developer.apple.com/documentation/applicationservices/axvaluetype
const AX_VALUE_TYPE_CG_RECT: i32 = 3;
const AX_VALUE_TYPE_CF_RANGE: i32 = 4;

// CGRect structures for macOS coordinate system
#[repr(C)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

// declare external functions from macOS ApplicationServices framework
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    unsafe fn AXIsProcessTrusted() -> bool;

    unsafe fn AXUIElementCreateSystemWide() -> CFTypeRef;

    unsafe fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;

    unsafe fn AXUIElementSetAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> i32;

    unsafe fn AXUIElementCopyParameterizedAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        parameter: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;

    unsafe fn AXValueCreate(value_type: i32, value_ptr: *const c_void) -> CFTypeRef;

    unsafe fn AXValueGetValue(value: CFTypeRef, value_type: i32, value_ptr: *mut c_void) -> bool;
}

/// Get UI element attribute value.
fn get_element_attribute(element: &CFType, attribute: &str) -> Result<CFType, AppError> {
    unsafe {
        let mut value_ptr: CFTypeRef = std::ptr::null();
        let error_code = AXUIElementCopyAttributeValue(
            element.as_CFTypeRef(),
            CFString::new(attribute).as_concrete_TypeRef(),
            &mut value_ptr,
        );

        if error_code != 0 || value_ptr.is_null() {
            return Err(format!("Failed to get {}, error code: {}", attribute, error_code).into());
        }

        Ok(CFType::wrap_under_create_rule(value_ptr))
    }
}

/// Set UI element attribute value.
fn set_element_attribute(
    element: &CFType,
    attribute: &str,
    value: CFTypeRef,
) -> Result<(), AppError> {
    unsafe {
        let error_code = AXUIElementSetAttributeValue(
            element.as_CFTypeRef(),
            CFString::new(attribute).as_concrete_TypeRef(),
            value,
        );

        if error_code != 0 {
            return Err(format!("Failed to set {}, error code: {}", attribute, error_code).into());
        }

        Ok(())
    }
}

/// Get currently focused UI element.
fn get_focused_element() -> Result<CFType, AppError> {
    unsafe {
        // check accessibility permission
        if !AXIsProcessTrusted() {
            return Err("Accessibility permission not granted".into());
        }

        // create system-wide AXUIElement
        let sys_element_ptr = AXUIElementCreateSystemWide();
        if sys_element_ptr.is_null() {
            return Err("Failed to create system-wide AXUIElement".into());
        }
        let sys_element = CFType::wrap_under_create_rule(sys_element_ptr);

        // get focused element
        get_element_attribute(&sys_element, "AXFocusedUIElement")
    }
}

/// Get selected text attribute from given element.
fn get_selected_text(element: &CFType) -> Option<String> {
    // try to get selected text
    if let Ok(selected_text) = get_element_attribute(element, "AXSelectedText") {
        if let Some(text) = selected_text.downcast::<CFString>() {
            return Some(text.to_string());
        }
    }
    None
}

/// Get selected text range from given element.
fn get_selected_range(element: &CFType) -> Result<CFRange, AppError> {
    unsafe {
        // get currently selected text range
        let selected_text_range = get_element_attribute(element, "AXSelectedTextRange")?;

        // extract CFRange from AXValue
        let mut range = CFRange {
            location: 0,
            length: 0,
        };
        let get_range_success = AXValueGetValue(
            selected_text_range.as_CFTypeRef(),
            AX_VALUE_TYPE_CF_RANGE,
            &mut range as *mut _ as _,
        );
        if !get_range_success {
            return Err("Failed to get selection range".into());
        }

        Ok(range)
    }
}

/// Get selected text in currently focused element.
pub fn get_selection() -> Result<String, AppError> {
    // get focused element
    let focused_element = get_focused_element()?;

    // 1. try to get selected text directly from focused element
    if let Some(text) = get_selected_text(&focused_element) {
        return Ok(text);
    }

    // 2. if focused element has no selected text, try traversing child elements
    if let Ok(ax_children) = get_element_attribute(&focused_element, "AXChildren") {
        if let Some(children) = ax_children.downcast::<CFArray>() {
            // traverse child element array
            for i in 0..children.len() {
                unsafe {
                    // get raw pointer from array directly
                    if let Some(child_ptr) = children.get(i).map(|item| *item as CFTypeRef) {
                        if !child_ptr.is_null() {
                            // wrap pointer as CFType
                            let child_element = CFType::wrap_under_get_rule(child_ptr);
                            if let Some(text) = get_selected_text(&child_element) {
                                return Ok(text);
                            }
                        }
                    }
                }
            }
        }
    }

    // if not found, return empty string
    Ok(String::new())
}

/// Get the physical coordinates of the bottom-right corner of the selected text.
pub fn get_cursor_location() -> Result<(i32, i32), AppError> {
    unsafe {
        // get focused element
        let focused_element = get_focused_element()?;

        // get selected text range
        let selected_range = get_selected_range(&focused_element)?;
        if selected_range.length == 0 {
            return Err("No text selected".into());
        }

        // create CFRange for the last character of the selection
        let last_range = CFRange {
            location: selected_range.location + selected_range.length - 1,
            length: 1,
        };

        // create AXValue for the last character range
        let last_range_ptr = AXValueCreate(AX_VALUE_TYPE_CF_RANGE, &last_range as *const _ as _);
        if last_range_ptr.is_null() {
            return Err("Failed to create last character range AXValue".into());
        }
        let last_range_value = CFType::wrap_under_create_rule(last_range_ptr);

        // get bounds for the last character using kAXBoundsForRangeParameterizedAttribute
        let mut bounds_ptr: CFTypeRef = std::ptr::null();
        let error_code = AXUIElementCopyParameterizedAttributeValue(
            focused_element.as_CFTypeRef() as _,
            CFString::new("AXBoundsForRange").as_concrete_TypeRef(),
            last_range_value.as_CFTypeRef(),
            &mut bounds_ptr,
        );
        if error_code != 0 || bounds_ptr.is_null() {
            return Err(
                format!("Failed to get bounds for range, error code: {}", error_code).into(),
            );
        }
        let bounds_value = CFType::wrap_under_create_rule(bounds_ptr);

        // extract CGRect from AXValue
        let mut rect = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: 0.0,
                height: 0.0,
            },
        };
        let get_rect_success = AXValueGetValue(
            bounds_value.as_CFTypeRef(),
            AX_VALUE_TYPE_CG_RECT,
            &mut rect as *mut _ as _,
        );
        if !get_rect_success {
            return Err("Failed to get CGRect from bounds value".into());
        }

        // validate rectangle bounds
        if rect.size.width <= MIN_VALID_WIDTH
            || rect.size.height <= 0.0
            || rect.size.height >= MAX_VALID_HEIGHT
            || rect.origin.x < 0.0
            || rect.origin.y < 0.0
            || rect.origin.x >= MAX_VALID_COORDINATE
            || rect.origin.y >= MAX_VALID_COORDINATE
        {
            return Err("Invalid bounds coordinates".into());
        }

        // calculate bottom-right corner coordinates
        let bottom_right_x = (rect.origin.x + rect.size.width) as i32;
        let bottom_right_y = (rect.origin.y + rect.size.height) as i32;

        Ok((bottom_right_x, bottom_right_y))
    }
}

/// Check if currently focused element is editable.
pub fn is_cursor_editable() -> Result<bool, AppError> {
    // get focused element
    let focused_element = get_focused_element()?;

    // get role of focused element
    let ax_role = get_element_attribute(&focused_element, "AXRole")?;

    // check if role is editable type
    Ok(ax_role.downcast::<CFString>().is_some_and(|role| {
        EDITABLE_AX_ROLES
            .iter()
            .any(|r| role.to_string().contains(r))
    }))
}

/// Select specified number of characters from current cursor position backward.
pub fn select_backward_chars(chars: usize) -> Result<(), AppError> {
    unsafe {
        // get focused element
        let focused_element = get_focused_element()?;

        // get selected text range
        let orig_range = get_selected_range(&focused_element)?;

        // calculate new selection range
        let new_range = CFRange {
            location: (orig_range.location + orig_range.length - chars as isize).max(0),
            length: chars as isize,
        };

        // create AXValue object
        let new_range_ptr = AXValueCreate(AX_VALUE_TYPE_CF_RANGE, &new_range as *const _ as _);
        if new_range_ptr.is_null() {
            return Err("Failed to create new range AXValue".into());
        }
        let new_range_value = CFType::wrap_under_create_rule(new_range_ptr);

        // set new selection range
        set_element_attribute(
            &focused_element,
            "AXSelectedTextRange",
            new_range_value.as_CFTypeRef(),
        )?;

        Ok(())
    }
}
