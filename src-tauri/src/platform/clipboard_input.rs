//! Copy intent is kept with one clipboard transaction, never a global selected-text cache.
use crate::error::AppError;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub enum CopyInputKey {
    ControlLeft,
    ControlRight,
    Copy,
    Insert,
    Other,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct CopyObservation {
    pub copies: u64,
    pub changes: u64,
    pub down: bool,
    pub insert: bool,
    pub version: u64,
}

#[derive(Clone, Copy, Default)]
struct InputState {
    observation: CopyObservation,
    controls: u8,
    copy_down: bool,
}
impl InputState {
    fn key(&mut self, key: CopyInputKey, pressed: bool) {
        match key {
            CopyInputKey::ControlLeft | CopyInputKey::ControlRight => {
                let bit = if matches!(key, CopyInputKey::ControlLeft) {
                    1
                } else {
                    2
                };
                self.controls = if pressed {
                    self.controls | bit
                } else {
                    self.controls & !bit
                };
            }
            CopyInputKey::Copy | CopyInputKey::Insert => {
                self.copy_down = pressed;
                if pressed {
                    if self.controls != 0 {
                        self.observation.copies += 1;
                        self.observation.insert = matches!(key, CopyInputKey::Insert);
                    } else {
                        self.observation.changes += 1;
                    }
                }
            }
            CopyInputKey::Other if pressed => self.observation.changes += 1,
            _ => (),
        }
        self.observation.down = self.controls != 0 || self.copy_down;
    }
}

static INPUT: Mutex<InputState> = Mutex::new(InputState {
    observation: CopyObservation {
        copies: 0,
        changes: 0,
        down: false,
        insert: false,
        version: 0,
    },
    controls: 0,
    copy_down: false,
});

pub fn record_copy_input(key: CopyInputKey, pressed: bool) {
    if let Ok(mut state) = INPUT.lock() {
        state.key(key, pressed);
    }
}

pub struct ClipboardInputObserver {
    baseline: CopyObservation,
}
impl ClipboardInputObserver {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            baseline: INPUT.lock()?.observation,
        })
    }
    pub fn observe(&self) -> Result<CopyObservation, AppError> {
        let mut now = INPUT.lock()?.observation;
        now.copies -= self.baseline.copies;
        now.changes -= self.baseline.changes;
        #[cfg(target_os = "windows")]
        {
            #[link(name = "user32")]
            unsafe extern "system" {
                fn GetClipboardSequenceNumber() -> u32;
            }
            now.version = unsafe { GetClipboardSequenceNumber() }.into();
        }
        #[cfg(target_os = "macos")]
        {
            now.version = super::macos::clipboard_change_count();
        }
        Ok(now)
    }
}

#[cfg(test)]
#[test]
fn copy_intent_survives_synthetic_releases_and_requires_real_copy_chord() {
    let mut state = InputState::default();
    state.key(CopyInputKey::ControlLeft, true); // already held when capture starts
                                                // Synthetic releases are excluded by the source/marker filter, so do not change state.
    state.key(CopyInputKey::Copy, true);
    assert_eq!(state.observation.copies, 1);
    assert!(state.observation.down);
    state.key(CopyInputKey::Copy, false);
    state.key(CopyInputKey::ControlLeft, false);
    assert!(!state.observation.down);
    assert_eq!(state.observation.changes, 0);
    state.key(CopyInputKey::Other, true);
    assert_eq!(state.observation.changes, 1);
    state.key(CopyInputKey::Copy, true); // plain C is not copy intent
    assert_eq!(state.observation.copies, 1);
    assert_eq!(state.observation.changes, 2);
}

impl ClipboardInputObserver {
    pub fn interrupted(&self) -> Result<bool, AppError> {
        let observed = self.observe()?;
        Ok(observed.copies != 0 || observed.changes != 0)
    }
}
