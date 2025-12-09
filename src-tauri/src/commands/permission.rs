use crate::error::AppError;

#[cfg(target_os = "macos")]
const K_IOHID_REQUEST_TYPE_LISTEN_EVENT: i32 = 1;

#[cfg(target_os = "macos")]
const K_IOHID_ACCESS_TYPE_GRANTED: i32 = 0;

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    unsafe fn IOHIDCheckAccess(request_type: i32) -> i32;
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    unsafe fn AXIsProcessTrusted() -> bool;
}

/// Check if the application has accessibility permissions on macOS.
#[tauri::command]
pub fn check_accessibility() -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        unsafe { Ok(AXIsProcessTrusted()) }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // always return true on non-macOS platforms
        Ok(true)
    }
}

/// Open macOS accessibility settings page.
#[tauri::command]
pub fn open_accessibility() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open accessibility settings: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility settings are only available on macOS".into())
    }
}

/// Check if the application has input monitoring permissions on macOS.
#[tauri::command]
pub fn check_input_monitoring() -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            Ok(IOHIDCheckAccess(K_IOHID_REQUEST_TYPE_LISTEN_EVENT) == K_IOHID_ACCESS_TYPE_GRANTED)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // always return true on non-macOS platforms
        Ok(true)
    }
}

/// Open macOS input monitoring settings page.
#[tauri::command]
pub fn open_input_monitoring() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn()
            .map_err(|e| format!("Failed to open input monitoring settings: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Input monitoring settings are only available on macOS".into())
    }
}
