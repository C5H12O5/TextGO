use crate::error::AppError;
use serde::Serialize;
use std::{fs::File, io::Read, sync::Arc, time::Duration};
use tauri::{ipc::Channel, Manager, ResourceId, Webview};
use tauri_plugin_http::reqwest;
use tauri_plugin_updater::Update;
use textgo_delta::{MAX_FILE, MAX_PATCH};

#[cfg(target_os = "macos")]
const PLATFORM: &str = "darwin";
#[cfg(target_os = "windows")]
const PLATFORM: &str = "windows";

type Error = Box<dyn std::error::Error + Send + Sync>;

#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum DeltaEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

// Use the Update returned by the official check in this webview. The frontend cannot
// supply download URLs, public keys, signatures or paths to an installer.
#[tauri::command]
pub async fn try_install_delta(
    webview: Webview,
    rid: ResourceId,
    on_event: Channel<DeltaEvent>,
) -> Result<bool, AppError> {
    if webview.label() != "main" {
        return Err("Updates are managed by the main window".into());
    }
    let update = webview.resources_table().get::<Update>(rid)?;
    let Some(public_key) = webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config["pubkey"].as_str())
    else {
        return Ok(false);
    };
    let bytes = match fetch_delta(update.clone(), public_key.to_owned(), &on_event).await {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Ok(false),
        Err(error) => {
            log::warn!("Delta update unavailable, using full update: {error}");
            return Ok(false);
        }
    };
    // Once installation starts an error must be propagated, not retried as a second install.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(true)
}

async fn fetch_delta(
    update: Arc<Update>,
    public_key: String,
    events: &Channel<DeltaEvent>,
) -> Result<Option<Vec<u8>>, Error> {
    let name = format!(
        "TextGO-delta-v1-{PLATFORM}-{}-from-{}.patch",
        std::env::consts::ARCH,
        update.current_version
    );
    let url = update.download_url.join(&name)?;
    if url.scheme() != "https" {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent(concat!("TextGO/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()?;
    let response = client.get(url).send().await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let mut response = response.error_for_status()?;
    let total = response.content_length();
    const LIMIT: usize = MAX_PATCH + 2048;
    if total.is_some_and(|n| n > LIMIT as u64) {
        return Err("oversized delta download".into());
    }
    let _ = events.send(DeltaEvent::Started {
        content_length: total,
    });
    let mut envelope = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > LIMIT - envelope.len() {
            return Err("oversized delta download".into());
        }
        envelope.extend_from_slice(&chunk);
        let _ = events.send(DeltaEvent::Progress {
            chunk_length: chunk.len(),
        });
    }
    let _ = events.send(DeltaEvent::Finished);
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, Error> {
        let payload = textgo_delta::open_envelope(&envelope, &public_key, &update.version)?;
        let file = File::open(std::env::current_exe()?)?;
        let size = file.metadata()?.len();
        if size > MAX_FILE as u64 {
            return Err("installed executable exceeds delta size limit".into());
        }
        let mut base = Vec::with_capacity(size as usize);
        file.take(size + 1).read_to_end(&mut base)?;
        let bytes = textgo_delta::restore(&base, payload, PLATFORM)?;
        update.verify(&bytes)?;
        Ok(bytes)
    })
    .await??;
    Ok(Some(bytes))
}
