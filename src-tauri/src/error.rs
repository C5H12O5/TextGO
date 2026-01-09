use log::error;

#[derive(Debug, Clone)]
pub struct AppError(String);

impl std::error::Error for AppError {}

// implement Display, so error messages can be printed directly
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// implement Serialize, so it can be used as a Tauri command return type
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

// create AppError from strings
impl AppError {
    #[track_caller]
    fn new(msg: impl Into<String>) -> Self {
        let msg = msg.into();
        let location = std::panic::Location::caller();
        error!("[{}:{}] {}", location.file(), location.line(), msg);
        AppError(msg)
    }
}

impl From<&str> for AppError {
    #[track_caller]
    fn from(error: &str) -> Self {
        AppError::new(error)
    }
}

impl From<String> for AppError {
    #[track_caller]
    fn from(error: String) -> Self {
        AppError::new(error)
    }
}

impl From<&String> for AppError {
    #[track_caller]
    fn from(error: &String) -> Self {
        AppError::new(error.as_str())
    }
}

// macro to implement From for multiple error types
macro_rules! impl_from_error {
    // regular types
    ($($t:ty),* $(,)?) => {
        $(
            impl From<$t> for AppError {
                #[track_caller]
                fn from(error: $t) -> Self {
                    AppError::new(error.to_string())
                }
            }
        )*
    };
    // generic types
    (generic: $($t:ty),* $(,)?) => {
        $(
            impl<T> From<$t> for AppError {
                #[track_caller]
                fn from(error: $t) -> Self {
                    AppError::new(error.to_string())
                }
            }
        )*
    };
}

impl_from_error!(
    std::io::Error,
    std::sync::mpsc::RecvError,
    serde_json::error::Error,
    tauri::Error,
    tauri_plugin_global_shortcut::Error,
    enigo::InputError,
    &enigo::NewConError,
    &mut enigo::NewConError,
    Box<dyn std::error::Error + Send + Sync>,
);
impl_from_error!(generic: std::sync::PoisonError<T>);
