use crate::error::AppError;
use crate::platform;
use std::path::PathBuf;

/// Get application identifier from an application path.
/// - On macOS: Returns the bundle identifier (e.g., "com.apple.Safari")
/// - On Windows: Returns the normalized executable path (e.g., "C:\\Program Files\\App\\app.exe")
#[tauri::command]
pub fn get_app_id(app_path: String) -> Result<String, AppError> {
    platform::get_app_identifier(&PathBuf::from(app_path))
}
