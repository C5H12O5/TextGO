use crate::error::AppError;
use crate::platform::{self, ClipboardInputObserver, CopyObservation};
use crate::{CLIPBOARD, CLIPBOARD_CHANGE_EPOCH};
use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContent, ContentFormat};
use log::{debug, warn};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::{Mutex, MutexGuard};

// Serialize the complete backup -> operation -> restore, including paste consumption.
static TRANSACTION: Mutex<()> = Mutex::const_new(());
static OPERATION_GENERATION: AtomicU64 = AtomicU64::new(0);
pub(super) fn invalidate_clipboard_repair() {
    OPERATION_GENERATION.fetch_add(1, Ordering::SeqCst);
}

const ALL_FORMATS: [ContentFormat; 5] = [
    ContentFormat::Text,
    ContentFormat::Rtf,
    ContentFormat::Html,
    ContentFormat::Image,
    ContentFormat::Files,
];

type Snapshot = Vec<(u8, Vec<u8>)>;

fn snapshot(contents: &[ClipboardContent]) -> Result<Snapshot, AppError> {
    contents
        .iter()
        .map(|content| {
            Ok(match content {
                ClipboardContent::Text(text) => (0, text.as_bytes().to_vec()),
                ClipboardContent::Rtf(text) => (1, text.as_bytes().to_vec()),
                ClipboardContent::Html(text) => (2, text.as_bytes().to_vec()),
                ClipboardContent::Image(image) => (3, image.to_png()?.get_bytes().to_vec()),
                ClipboardContent::Files(files) => (4, serde_json::to_vec(files)?),
                ClipboardContent::Other(_, _) => {
                    return Err("Unsupported clipboard backup format".into())
                }
            })
        })
        .collect()
}

fn contents(clipboard: &impl Clipboard) -> Result<Vec<ClipboardContent>, AppError> {
    // Read only advertised formats so absent formats are not restored as empty payloads.
    let formats: Vec<_> = ALL_FORMATS
        .iter()
        .filter(|format| clipboard.has((*format).clone()))
        .cloned()
        .collect();
    let contents = clipboard.get(&formats)?;
    // clipboard-rs can omit individual formats whose reads fail. Never restore a partial backup.
    if contents.len() != formats.len() {
        return Err("Could not read every advertised clipboard format".into());
    }
    Ok(contents)
}

/// Get clipboard text content.
#[tauri::command]
pub fn get_clipboard_text() -> Result<String, AppError> {
    run(|| match CLIPBOARD.lock()?.as_ref()?.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    })
}

/// An explicit clipboard write takes precedence over temporary capture/paste.
#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<(), AppError> {
    run(|| {
        let guard = CLIPBOARD.lock()?;
        CLIPBOARD_CHANGE_EPOCH.fetch_add(1, Ordering::SeqCst);
        Ok(guard.as_ref()?.set_text(text)?)
    })
}

#[tauri::command]
pub fn clear_clipboard() -> Result<(), AppError> {
    run(|| {
        let guard = CLIPBOARD.lock()?;
        CLIPBOARD_CHANGE_EPOCH.fetch_add(1, Ordering::SeqCst);
        Ok(guard.as_ref()?.clear()?)
    })
}

/// Once input has been queued, caller cancellation must not restore before the target reads it.
pub(super) async fn complete_clipboard_operation<T: Send + 'static>(
    operation: impl std::future::Future<Output = Result<T, AppError>> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn(operation)
        .await
        .map_err(|error| error.to_string())?
}

/// Owns temporary clipboard contents, and restores on errors and future cancellation too.
/// No clipboard lock is held across an await; the separate transaction lock is.
pub(super) struct ClipboardTransaction {
    _serial: MutexGuard<'static, ()>,
    backup: Option<Vec<ClipboardContent>>,
    expected: Snapshot,
    epoch: u64,
    input: Option<Arc<ClipboardInputObserver>>,
    capture: bool,
    captured_at: Option<Instant>,
    source: Option<platform::FocusTarget>,
    generation: u64,
}

impl ClipboardTransaction {
    pub async fn begin(restore: bool) -> Result<Self, AppError> {
        let serial = TRANSACTION.lock().await;
        let generation = OPERATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        // Set up input protection before touching the clipboard.
        let input = if restore {
            Some(Arc::new(ClipboardInputObserver::new()?))
        } else {
            None
        };
        let epoch = CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst);
        let backup = if restore {
            Some(run(|| contents(CLIPBOARD.lock()?.as_ref()?))?)
        } else {
            None
        };
        let expected = backup
            .as_deref()
            .map(snapshot)
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            _serial: serial,
            backup,
            expected,
            epoch,
            input,
            capture: false,
            captured_at: None,
            source: None,
            generation,
        })
    }

    pub async fn begin_capture() -> Result<Self, AppError> {
        let mut transaction = Self::begin(true).await?;
        transaction.capture = true;
        transaction.source = platform::get_focus_target();
        Ok(transaction)
    }

    fn capture_interrupted(&self) -> Result<bool, AppError> {
        if let Some(input) = &self.input {
            // A same-selection copy is allowed to complete. Other input invalidates capture.
            if input.observe()?.changes != 0 {
                return Ok(true);
            }
        }
        Ok(CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst) != self.epoch)
    }

    fn interrupted(&self) -> Result<bool, AppError> {
        if let Some(input) = &self.input {
            if input.interrupted()? {
                return Ok(true);
            }
        }
        Ok(CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst) != self.epoch)
    }

    /// Revalidate on the main thread immediately before delivering already queued input.
    pub fn input_check(&self) -> impl FnOnce() -> Result<(), AppError> + Send + 'static {
        let epoch = self.epoch;
        let capture = self.capture;
        let expected = self.expected.clone();
        let input = self.input.clone();
        move || {
            if let Some(input) = &input {
                let observed = input.observe()?;
                if observed.changes != 0 || (!capture && observed.copies != 0) {
                    return Err("Clipboard operation interrupted by user input".into());
                }
            }
            let guard = CLIPBOARD.lock()?;
            if !may_restore(
                epoch,
                CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst),
                &expected,
                &snapshot(&contents(guard.as_ref()?)?)?,
            ) {
                return Err("Clipboard changed before the queued input could be delivered".into());
            }
            if let Some(input) = &input {
                let observed = input.observe()?;
                if observed.changes != 0 || (!capture && observed.copies != 0) {
                    return Err("Clipboard operation interrupted during clipboard read".into());
                }
            }
            if CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst) != epoch {
                return Err("Clipboard operation interrupted during clipboard read".into());
            }
            Ok(())
        }
    }

    pub fn set_text(&mut self, text: String) -> Result<(), AppError> {
        self.write(Some(text))
    }

    pub fn clear(&mut self) -> Result<(), AppError> {
        self.write(None)
    }

    fn write(&mut self, text: Option<String>) -> Result<(), AppError> {
        if self.interrupted()? {
            return Err("Clipboard operation interrupted by user input".into());
        }
        let previous = self.expected.clone();
        let expected = text
            .as_ref()
            .map(|text| vec![(0, text.as_bytes().to_vec())])
            .unwrap_or_default();
        let protect = self.backup.is_some();
        let epoch = self.epoch;
        let input = self.input.clone();
        // Distinguish preflight errors (we wrote nothing) from a partially failed native write.
        let attempted = run(move || {
            let guard = CLIPBOARD.lock()?;
            let clipboard = guard.as_ref()?;
            if protect && snapshot(&contents(clipboard)?)? != previous {
                return Err("Clipboard changed before temporary clipboard write".into());
            }
            if let Some(input) = input {
                if input.interrupted()? {
                    return Err("Clipboard operation interrupted by user input".into());
                }
            }
            if CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst) != epoch {
                return Err("Clipboard operation interrupted by a newer clipboard write".into());
            }
            Ok(match text {
                Some(text) => clipboard.set_text(text),
                None => clipboard.clear(),
            }
            .map_err(AppError::from))
        })?;
        self.expected = expected;
        attempted
    }

    /// Record exactly the content we read, not a later unrelated clipboard value.
    pub fn read_copied_text(&mut self) -> Result<String, AppError> {
        if self.capture_interrupted()? {
            return Err("Selection capture interrupted by user input".into());
        }
        let (text, current) = run(|| {
            let guard = CLIPBOARD.lock()?;
            let clipboard = guard.as_ref()?;
            let current = contents(clipboard)?;
            let text = current
                .iter()
                .find_map(|content| match content {
                    ClipboardContent::Text(text) => Some(text.clone()),
                    _ => None,
                })
                .unwrap_or_default();
            Ok((text, snapshot(&current)?))
        })?;
        if self.capture_interrupted()? {
            return Err("Selection capture interrupted by user input".into());
        }
        if !text.is_empty() {
            self.expected = current;
            self.captured_at = Some(Instant::now());
        }
        Ok(text)
    }

    pub fn finish_capture(mut self, app: AppHandle) -> Result<(), AppError> {
        let repair = match (
            self.source,
            self.captured_at,
            self.input.clone(),
            self.backup.as_ref(),
        ) {
            (Some(source), Some(captured_at), Some(input), Some(backup)) => {
                let expected = snapshot(backup)?;
                if expected != self.expected {
                    Some((
                        CopyRepair {
                            expected,
                            epoch: self.epoch,
                            generation: self.generation,
                            source,
                            deadline: captured_at + Duration::from_secs(1),
                            version: 0,
                        },
                        input,
                    ))
                } else {
                    None
                }
            }
            _ => None,
        };
        self.restore()?;
        if let Some((mut repair, input)) = repair {
            repair.version = input.observe()?.version;
            tauri::async_runtime::spawn(async move {
                if let Err(error) = repair.wait_and_replay(app, input).await {
                    debug!("Copy compensation canceled: {error}");
                }
            });
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<(), AppError> {
        let result = self.restore();
        if let Err(error) = &result {
            warn!("Could not restore clipboard: {error}");
        }
        result
    }

    fn restore(&mut self) -> Result<(), AppError> {
        let Some(backup) = self.backup.take() else {
            return Ok(());
        };
        if self.interrupted()? {
            debug!("Clipboard restore skipped: newer user input or clipboard write");
            return Ok(());
        }
        let expected = std::mem::take(&mut self.expected);
        let epoch = self.epoch;
        let input = self.input.take();
        run(move || {
            let guard = CLIPBOARD.lock()?;
            let clipboard = guard.as_ref()?;
            // Also protect menu copies and external clipboard changes, not only Ctrl+C.
            if !may_restore(
                epoch,
                CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst),
                &expected,
                &snapshot(&contents(clipboard)?)?,
            ) {
                debug!("Clipboard restore skipped: clipboard no longer belongs to this operation");
                return Ok(());
            }
            // Reads of rich clipboard formats can block; recheck after them as well.
            if let Some(input) = input {
                if input.interrupted()? {
                    return Ok(());
                }
            }
            if CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst) != epoch {
                return Ok(());
            }
            if backup.is_empty() {
                clipboard.clear()?;
            } else {
                clipboard.set(backup)?;
            }
            Ok(())
        })
    }
}

impl Drop for ClipboardTransaction {
    fn drop(&mut self) {
        if let Err(error) = self.restore() {
            warn!("Could not restore clipboard: {error}");
        }
    }
}

// One exact capture may replay one genuine copy gesture; it never writes cached selection text.
struct CopyRepair {
    expected: Snapshot,
    epoch: u64,
    generation: u64,
    source: platform::FocusTarget,
    deadline: Instant,
    version: u64,
}
impl CopyRepair {
    fn allowed(
        &self,
        observed: CopyObservation,
        epoch: u64,
        generation: u64,
        focused: bool,
        current: &Snapshot,
    ) -> bool {
        observed.copies == 1
            && observed.changes == 0
            && !observed.down
            && observed.version == self.version
            && epoch == self.epoch
            && generation == self.generation
            && focused
            && current == &self.expected
    }

    fn try_replay(
        self,
        observed: CopyObservation,
        epoch: u64,
        generation: u64,
        focused: bool,
        current: &Snapshot,
        replay: impl FnOnce(bool) -> Result<(), AppError>,
    ) -> Result<bool, AppError> {
        if Instant::now() >= self.deadline
            || !self.allowed(observed, epoch, generation, focused, current)
        {
            return Ok(false);
        }
        // Consume the repair and invalidate before injection, including delayed synthetic events.
        invalidate_clipboard_repair();
        replay(observed.insert)?;
        Ok(true)
    }

    async fn wait_and_replay(
        self,
        app: AppHandle,
        input: Arc<ClipboardInputObserver>,
    ) -> Result<(), AppError> {
        while Instant::now() < self.deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let observed = input.observe()?;
            if observed.changes != 0
                || observed.copies > 1
                || observed.version != self.version
                || OPERATION_GENERATION.load(Ordering::SeqCst) != self.generation
            {
                return Ok(());
            }
            if observed.copies != 1 || observed.down {
                continue;
            }
            // Give the user's original key event its normal chance to copy first.
            tokio::time::sleep(Duration::from_millis(100)).await;
            let _serial = TRANSACTION.lock().await;
            if Instant::now() >= self.deadline {
                return Ok(());
            }
            let _shortcuts = crate::commands::shortcut::ShortcutHandlerGuard::suspend();
            let (sender, receiver) = tokio::sync::oneshot::channel();
            app.run_on_main_thread(move || {
                let result = (|| -> Result<(), AppError> {
                    let current = contents(CLIPBOARD.lock()?.as_ref()?)?;
                    let current = snapshot(&current)?;
                    let observed = input.observe()?;
                    let focused = platform::is_focus_target_active(self.source);
                    self.try_replay(
                        observed,
                        CLIPBOARD_CHANGE_EPOCH.load(Ordering::SeqCst),
                        OPERATION_GENERATION.load(Ordering::SeqCst),
                        focused,
                        &current,
                        crate::commands::keyboard::replay_copy_keys,
                    )?;
                    Ok(())
                })();
                let _ = sender.send(result);
            })?;
            let result = receiver.await.map_err(|error| error.to_string());
            // The key-release events may arrive after the main-thread injection returns.
            tokio::time::sleep(Duration::from_millis(100)).await;
            return result?;
        }
        Ok(())
    }
}

fn may_restore(epoch: u64, current_epoch: u64, expected: &Snapshot, current: &Snapshot) -> bool {
    epoch == current_epoch && expected == current
}

/// Run function on main thread if on macOS, otherwise run directly.
fn run<F, T>(func: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    #[cfg(target_os = "macos")]
    {
        use crate::APP_HANDLE;

        let (tx, rx) = std::sync::mpsc::channel();
        if let Some(app) = APP_HANDLE.lock()?.clone() {
            app.run_on_main_thread(move || {
                let _ = tx.send(func());
            })?;
        }
        rx.recv()?
    }

    #[cfg(not(target_os = "macos"))]
    {
        func()
    }
}

#[cfg(test)]
mod ownership_tests {
    use super::*;

    #[test]
    fn newer_copies_and_non_text_changes_are_never_replaced() {
        let a = vec![(0, b"selection A".to_vec())];
        let b = vec![(0, b"new B".to_vec())];
        assert!(may_restore(7, 7, &a, &a));
        assert!(!may_restore(7, 8, &a, &b));
        assert!(!may_restore(7, 7, &a, &b)); // menu/external copy without a key event
        assert!(!may_restore(7, 8, &a, &a)); // user explicitly copied identical bytes
        assert!(!may_restore(7, 7, &a, &vec![])); // newer clipboard clear
        let mut rich = a.clone();
        rich.push((2, b"<b>selection A</b>".to_vec()));
        assert!(!may_restore(7, 7, &a, &rich)); // same text, different formats
    }

    #[test]
    fn rapid_copy_replays_fresh_selection_but_never_replaces_newer_clipboard() {
        let original = vec![(0, b"original O".to_vec())];
        let newer = vec![(0, b"new B".to_vec())];
        let repair = CopyRepair {
            expected: original.clone(),
            epoch: 7,
            generation: 12,
            source: 1,
            version: 4,
            deadline: Instant::now() + Duration::from_secs(1),
        };
        let copy = CopyObservation {
            copies: 1,
            changes: 0,
            down: false,
            insert: false,
            version: 4,
        };
        // Same-selection A was copied at the final restore boundary, then O overwrote it.
        // Compensation authorizes a fresh copy gesture; it has no cached A to write.
        assert!(repair.allowed(copy, 7, 12, true, &original));
        // A genuinely late copy whose target already responded must not be replayed.
        assert!(!repair.allowed(CopyObservation { version: 5, ..copy }, 7, 12, true, &newer));
        // Even same-byte O written by another owner cancels through native generation.
        assert!(!repair.allowed(
            CopyObservation { version: 5, ..copy },
            7,
            12,
            true,
            &original
        ));
        assert!(!repair.allowed(copy, 7, 12, true, &newer));
        assert!(!repair.allowed(copy, 7, 12, false, &original)); // focus changed
        assert!(!repair.allowed(copy, 8, 12, true, &original)); // explicit new copy/write
        assert!(!repair.allowed(copy, 7, 13, true, &original)); // newer action / consumed replay
        assert!(!repair.allowed(
            CopyObservation { changes: 1, ..copy },
            7,
            12,
            true,
            &original
        ));
        assert!(!repair.allowed(
            CopyObservation { copies: 2, ..copy },
            7,
            12,
            true,
            &original
        ));
        assert!(!repair.allowed(
            CopyObservation { copies: 0, ..copy },
            7,
            12,
            true,
            &original
        ));
        assert!(!repair.allowed(
            CopyObservation { down: true, ..copy },
            7,
            12,
            true,
            &original
        ));
        let current_source_selection = "selection A";
        let mut clipboard = "original O";
        assert!(repair
            .try_replay(copy, 7, 12, true, &original, |insert| {
                assert!(!insert);
                clipboard = current_source_selection; // target's fresh copy response, not cached data
                Ok(())
            })
            .unwrap());
        assert_eq!(clipboard, "selection A");
    }

    #[test]
    fn canceling_queued_capture_never_starts_an_operation() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let serial = TRANSACTION.lock().await;
            let (queued, waiting) = tokio::sync::oneshot::channel();
            let caller = tokio::spawn(async move {
                queued.send(()).unwrap();
                let _clipboard = ClipboardTransaction::begin(true).await;
                panic!("canceled queued operation was started");
            });
            waiting.await.unwrap();
            caller.abort();
            assert!(caller.await.unwrap_err().is_cancelled());
            drop(serial);
            assert!(TRANSACTION.try_lock().is_ok());
        });
    }

    #[test]
    fn transactions_remain_serialized_when_the_caller_is_canceled() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (started, waiting) = tokio::sync::oneshot::channel();
            let (consume, consumed) = tokio::sync::oneshot::channel();
            let (finished, done) = tokio::sync::oneshot::channel();
            let caller = tokio::spawn(complete_clipboard_operation(async move {
                let _serial = TRANSACTION.lock().await;
                started.send(()).unwrap();
                consumed.await.unwrap();
                finished.send(()).unwrap();
                Err::<(), AppError>("simulated operation failure".into())
            }));
            waiting.await.unwrap();
            assert!(TRANSACTION.try_lock().is_err());
            caller.abort();
            // Detaching the caller is not permission to restore before target consumption.
            assert!(TRANSACTION.try_lock().is_err());
            consume.send(()).unwrap();
            done.await.unwrap();
            let _serial = TRANSACTION.lock().await;
        });
    }
}
