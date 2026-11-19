use crate::error::AppError;
use crate::handlers::handle_mouse_event;
use crate::SIMULATED_INPUT_MARKER;
use enigo::{Enigo, NewConError, Settings};
use std::sync::{LazyLock, Mutex, MutexGuard};
#[cfg(target_os = "macos")]
use std::time::Duration;

type Connection = Result<Enigo, NewConError>;
static ENIGO: LazyLock<Mutex<Connection>> = LazyLock::new(|| Mutex::new(connect_enigo(true)));

fn connect_enigo(prompt: bool) -> Connection {
    Enigo::new(&Settings {
        open_prompt_to_get_permissions: prompt,
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
        || connect_enigo(false),
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
    mut sleep: impl FnMut(Duration),
) {
    const PERMISSION_CHECK_INTERVAL: Duration = Duration::from_secs(2);
    const MAX_RETRY_DELAY: Duration = Duration::from_secs(30);
    let mut retry_delay = PERMISSION_CHECK_INTERVAL;

    // rdev blocks in the event tap's run loop. Only a failed setup reaches the retry path.
    while let Err(error) = listen() {
        log::warn!("Mouse event listener failed to start: {:?}", error);
        sleep(retry_delay);
        while !trusted() {
            sleep(PERMISSION_CHECK_INTERVAL);
        }
        retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn working_listener_starts_once_without_polling() {
        let mut attempts = 0;
        listen_with_retry(
            || {
                attempts += 1;
                Ok(())
            },
            || panic!("polled permission for a working listener"),
            |_| panic!("delayed a working listener"),
        );
        assert_eq!(attempts, 1);
    }

    #[test]
    fn failed_listener_waits_for_trust_then_retries_transient_errors() {
        let mut permissions = [false, false, true, true].into_iter();
        let mut attempts = 0;
        let mut delays = Vec::new();
        listen_with_retry(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err(rdev::ListenError::EventTapError)
                } else {
                    Ok(())
                }
            },
            || permissions.next().unwrap(),
            |delay| delays.push(delay.as_secs()),
        );
        assert_eq!(attempts, 3);
        assert_eq!(delays, [2, 2, 2, 4]);
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
