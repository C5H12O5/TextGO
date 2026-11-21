use crate::error::AppError;
use crate::handlers::handle_mouse_event;
use crate::SIMULATED_INPUT_MARKER;
use enigo::{Enigo, NewConError, Settings};
use std::sync::{LazyLock, Mutex, MutexGuard};
#[cfg(target_os = "macos")]
use std::time::Duration;

type Connection = Result<Enigo, NewConError>;
static ENIGO: LazyLock<Mutex<Connection>> = LazyLock::new(|| Mutex::new(connect_enigo()));

fn connect_enigo() -> Connection {
    Enigo::new(&Settings {
        open_prompt_to_get_permissions: false,
        event_source_user_data: Some(SIMULATED_INPUT_MARKER.into()),
        windows_dw_extra_info: Some(SIMULATED_INPUT_MARKER as usize),
        ..Settings::default()
    })
}

pub(crate) fn lock_enigo() -> Result<MutexGuard<'static, Connection>, AppError> {
    #[allow(unused_mut)]
    let mut connection = ENIGO.lock()?;
    #[cfg(target_os = "macos")]
    retry_denied_connection(
        &mut connection,
        crate::commands::check_accessibility,
        connect_enigo,
    );
    Ok(connection)
}

#[cfg(target_os = "macos")]
fn retry_denied_connection<T>(
    connection: &mut Result<T, NewConError>,
    trusted: impl FnOnce() -> bool,
    connect: impl FnOnce() -> Result<T, NewConError>,
) {
    if matches!(connection, Err(NewConError::NoPermission)) && trusted() {
        *connection = connect();
    }
}

pub(crate) fn start_mouse_listener() {
    // https://github.com/Narsil/rdev/issues/165
    #[cfg(target_os = "macos")]
    rdev::set_is_main_thread(false);

    std::thread::spawn(|| {
        let listen = || rdev::listen(handle_mouse_event);
        #[cfg(target_os = "macos")]
        listen_with_retry(
            listen,
            crate::commands::check_accessibility,
            || {
                crate::commands::request_accessibility_prompt();
            },
            std::thread::sleep,
        );
        #[cfg(not(target_os = "macos"))]
        if let Err(error) = listen() {
            log::error!("Error starting mouse event listener: {:?}", error);
        }
    });
}

#[cfg(target_os = "macos")]
fn listen_with_retry(
    mut listen: impl FnMut() -> Result<(), rdev::ListenError>,
    mut trusted: impl FnMut() -> bool,
    mut prompt: impl FnMut(),
    mut sleep: impl FnMut(Duration),
) {
    const PERMISSION_CHECK_INTERVAL: Duration = Duration::from_secs(1);
    const MAX_RETRY_DELAY: Duration = Duration::from_secs(30);
    let mut retry_delay = PERMISSION_CHECK_INTERVAL;
    let mut prompted = false;

    loop {
        // Wait for Accessibility before creating the CGEventTap; calling rdev::listen
        // while untrusted makes macOS prompt for Input Monitoring (kTCCServiceListenEvent)
        // or return a degraded event tap that blocks in CFRunLoopRun without recovering.
        let mut waited_for_permission = false;
        while !trusted() {
            if !prompted {
                prompt();
                prompted = true;
            }
            if !waited_for_permission {
                log::info!("Waiting for Accessibility permission before starting mouse listener");
                waited_for_permission = true;
            }
            sleep(PERMISSION_CHECK_INTERVAL);
        }
        if waited_for_permission {
            log::info!("Accessibility permission granted; starting mouse listener");
            retry_delay = PERMISSION_CHECK_INTERVAL;
        }

        // rdev blocks in the event tap's run loop. Only a failed setup reaches the retry path.
        match listen() {
            Ok(()) => return,
            Err(error) => {
                log::warn!("Mouse event listener failed to start: {:?}", error);
                sleep(retry_delay);
                retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
            }
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn working_listener_starts_once_without_polling() {
        let mut trust_checks = 0;
        let mut attempts = 0;
        listen_with_retry(
            || {
                attempts += 1;
                Ok(())
            },
            || {
                trust_checks += 1;
                true
            },
            || panic!("prompted for a trusted process"),
            |_| panic!("delayed a working listener"),
        );
        assert_eq!(trust_checks, 1);
        assert_eq!(attempts, 1);
    }

    #[test]
    fn untrusted_listener_prompts_once_and_waits_for_accessibility_before_starting() {
        let mut permissions = [false, false, true].into_iter();
        let attempts = std::cell::Cell::new(0);
        let prompts = std::cell::Cell::new(0);
        let mut delays = Vec::new();
        listen_with_retry(
            || {
                attempts.set(attempts.get() + 1);
                Ok(())
            },
            || permissions.next().unwrap(),
            || {
                assert_eq!(attempts.get(), 0, "must prompt before starting event tap");
                prompts.set(prompts.get() + 1);
            },
            |delay| {
                assert_eq!(
                    prompts.get(),
                    1,
                    "must prompt exactly once while waiting for accessibility"
                );
                assert_eq!(
                    attempts.get(),
                    0,
                    "must not start event tap before accessibility is granted"
                );
                delays.push(delay.as_secs());
            },
        );
        assert_eq!(prompts.get(), 1);
        assert_eq!(attempts.get(), 1);
        assert_eq!(delays, [1, 1]);
        assert_eq!(permissions.next(), None);
    }

    #[test]
    fn failed_listener_waits_for_trust_then_retries_transient_errors() {
        let mut permissions = [true, false, false, true, true, true].into_iter();
        let mut attempts = 0;
        let mut prompts = 0;
        let mut delays = Vec::new();
        listen_with_retry(
            || {
                attempts += 1;
                if attempts < 4 {
                    Err(rdev::ListenError::EventTapError)
                } else {
                    Ok(())
                }
            },
            || permissions.next().unwrap(),
            || prompts += 1,
            |delay| delays.push(delay.as_secs()),
        );
        assert_eq!(prompts, 1);
        assert_eq!(attempts, 4);
        assert_eq!(delays, [1, 1, 1, 1, 2]);
        assert_eq!(permissions.next(), None);
    }

    #[test]
    fn denied_input_connection_recovers_on_use_and_is_reused() {
        let mut connection = Err(NewConError::NoPermission);
        retry_denied_connection(&mut connection, || false, || panic!("retried before grant"));
        assert!(matches!(connection, Err(NewConError::NoPermission)));
        retry_denied_connection(&mut connection, || true, || Ok(42));
        retry_denied_connection(
            &mut connection,
            || panic!("polled permission for an open connection"),
            || panic!("replaced an open connection"),
        );
        assert_eq!(connection.unwrap(), 42);
    }
}
