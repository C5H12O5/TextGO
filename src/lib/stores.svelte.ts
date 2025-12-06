import { manager } from '$lib/manager';
import type { Entry, Model, Prompt, Regexp, Script, Shortcut } from '$lib/types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LazyStore } from '@tauri-apps/plugin-store';
import { tick, untrack } from 'svelte';

// create a global LazyStore instance
const store = new LazyStore('.settings.dat');

/**
 * Options for creating persisted state.
 */
type Options<T> = {
  /** Callback function when loading is complete. */
  onload?: (value: T) => void;
  /** Callback function when the stored value changes. */
  onchange?: (value: T | $state.Snapshot<T>) => void;
};

/**
 * Create a persisted reactive state.
 *
 * @param key - key for local storage
 * @param initial - initial value
 * @param options - persistence options
 * @returns persisted state object
 */
function persisted<T>(key: string, initial: T, options?: Options<T>) {
  let initialized = false;
  let syncing = false;
  let state = $state(initial);

  // load data from store
  store.get<T>(key).then((item) => {
    if (item !== undefined) {
      state = item;
      options?.onload?.(item);
      options?.onchange?.(item);
    }
    // mark as initialized
    tick().then(() => (initialized = true));
  });

  // watch for state changes and persist to store
  $effect.root(() => {
    $effect(() => {
      // get snapshot of current state
      const snapshot = $state.snapshot(state);
      untrack(() => {
        if (!initialized || syncing) {
          return;
        }
        // persist to store
        store.set(key, snapshot).then(() => {
          options?.onchange?.(snapshot);
          // use localStorage to notify other windows
          const currentWindow = getCurrentWindow().label;
          localStorage.removeItem(key);
          localStorage.setItem(key, currentWindow);
          console.info(`[${currentWindow}] Persisted key "${key}" to store.`);
        });
      });
    });

    // ensure it won't be cleaned up
    return () => {};
  });

  // listen for localStorage changes to implement cross-window sync
  window.addEventListener('storage', (event) => {
    if (!initialized) {
      return;
    }
    // only handle changes for the specific key and ignore changes from the same window
    const currentWindow = getCurrentWindow().label;
    if (event.key === key && event.newValue && event.newValue !== currentWindow) {
      console.info(`[${currentWindow}] Detected external change for key "${key}", reloading from store.`);
      syncing = true;
      store.get<T>(key).then((item) => {
        if (item !== undefined) {
          state = item;
          options?.onchange?.(item);
        }
        // wait two ticks to ensure all effects are processed
        tick().then(() => {
          tick().then(() => {
            syncing = false;
          });
        });
      });
    }
  });

  return {
    get current() {
      return state;
    },
    set current(value: T) {
      state = value;
    }
  };
}

// theme (light / dark)
export const theme = persisted<string>('theme', 'light', {
  onchange: (theme) => {
    // set data-theme attribute on root element to switch theme
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    // the theme set here is application-wide, not specific to the current window
    getCurrentWindow().setTheme(theme === 'light' ? 'light' : 'dark');
  }
});

// shortcut group
export const shortcuts = persisted<Record<string, Shortcut>>(
  'shortcuts',
  {},
  {
    onload: async (shortcuts) => {
      // register all shortcut groups when main window initializes
      if (getCurrentWindow().label === 'main') {
        for (const shortcut of Object.values(shortcuts)) {
          for (const rule of shortcut.rules) {
            await manager.register(rule);
          }
        }
      }
    }
  }
);

// auto start setting
export const autoStart = persisted<boolean>('autoStart', false);

// minimize to tray setting
export const minimizeToTray = persisted<boolean>('minimizeToTray', true);

// accessibility permission granted
export const accessibility = persisted<boolean>('accessibility', false);

// Node.js path
export const nodePath = persisted<string>('nodePath', '');

// Python path
export const pythonPath = persisted<string>('pythonPath', '');

// Ollama service address
export const ollamaHost = persisted<string>('ollamaHost', '');

// number of history records to retain
export const historySize = persisted<number>('historySize', 5);

// trigger record
export const entries = persisted<Entry[]>('entries', []);

// classification model
export const models = persisted<Model[]>('models', []);

// regular expression
export const regexps = persisted<Regexp[]>('regexps', []);

// script
export const scripts = persisted<Script[]>('scripts', []);

// prompt
export const prompts = persisted<Prompt[]>('prompts', []);
