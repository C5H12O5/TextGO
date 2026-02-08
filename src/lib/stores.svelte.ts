import { manager } from '$lib/shortcut';
import type { CustomLLMProvider, Entry, Model, Prompt, Regexp, Script, Searcher, Shortcut } from '$lib/types';
import { decrypt, encrypt } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, type Theme } from '@tauri-apps/api/window';
import { LazyStore } from '@tauri-apps/plugin-store';
import { debounce } from 'es-toolkit/function';
import { tick, untrack } from 'svelte';

// create a global LazyStore instance
const store = new LazyStore('.settings.dat');

// the type of snapshot of a state
type Snapshot<T> = ReturnType<typeof $state.snapshot<T>>;

/**
 * Options for creating persisted state.
 */
type Options<T> = {
  /** Callback function when loading is complete. */
  onload?: (value: T) => void;
  decrypt?: (value: T) => T;
  /** Callback function when the stored value changes. */
  onchange?: (value: T | Snapshot<T>) => void;
  encrypt?: (value: T | Snapshot<T>) => T;
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

  // get current window label
  const currentWindow = getCurrentWindow().label;

  // load data from store
  store.get<T>(key).then((item) => {
    if (item !== undefined) {
      state = options?.decrypt?.(item) ?? item;
      options?.onload?.(state);
      options?.onchange?.(state);
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
        store.set(key, options?.encrypt?.(snapshot) ?? snapshot).then(() => {
          options?.onchange?.(snapshot);
          // use localStorage to notify other windows
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
  const handleStorageChange = debounce((event: StorageEvent) => {
    if (!initialized) {
      return;
    }
    // only handle changes for the specific key and ignore changes from the same window
    if (event.key === key && event.newValue && event.newValue !== currentWindow) {
      console.info(`[${currentWindow}] Detected external change for key "${key}", reloading from store.`);
      syncing = true;
      store.get<T>(key).then((item) => {
        if (item !== undefined) {
          state = options?.decrypt?.(item) ?? item;
          options?.onchange?.(state);
        }
        // mark syncing as complete
        tick().then(() => (syncing = false));
      });
    }
  }, 100);
  // register storage event listener
  window.addEventListener('storage', handleStorageChange);

  return {
    get current() {
      return state;
    },
    set current(value: T) {
      state = value;
    }
  };
}

// theme (light / dark / system)
export const theme = persisted<string>('theme', 'light', {
  onchange: (theme) => {
    if (theme === 'system') {
      // follow system theme
      getCurrentWindow().setTheme(null);
    } else {
      // set data-theme attribute on root element to switch theme
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      // the theme set here is application-wide, not specific to the current window
      getCurrentWindow().setTheme(theme as Theme);
    }
  }
});

// shortcut groups
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

// blacklist of applications
export const blacklist = persisted<string[]>('blacklist', []);

// auto start setting
export const autoStart = persisted<boolean>('autoStart', false);

// minimize to tray setting
export const minimizeToTray = persisted<boolean>('minimizeToTray', false);

// accessibility permission granted
export const accessibility = persisted<boolean>('accessibility', false);

// whether the popup window is pinned
export const popupPinned = persisted<boolean>('popupPinned', false);

// number of history records to retain
export const historySize = persisted<number>('historySize', 5);

// whether to enable long press trigger
export const longPress = persisted<boolean>('longPress', false, {
  onchange: (enabled) => {
    invoke('set_long_press_enabled', { enabled });
  }
});

// duration threshold for long press trigger
export const longPressDuration = persisted<number>('longPressDuration', 1000, {
  onchange: (duration) => {
    invoke('set_long_press_duration', { duration });
  }
});

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

// searcher
export const searchers = persisted<Searcher[]>('searchers', []);

// Node.js path
export const nodePath = persisted<string>('nodePath', '');

// Deno path
export const denoPath = persisted<string>('denoPath', '');

// Python path
export const pythonPath = persisted<string>('pythonPath', '');

// Ollama service address
export const ollamaHost = persisted<string>('ollamaHost', '');

// LM Studio service address
export const lmstudioHost = persisted<string>('lmstudioHost', '');

// API keys for Cloud LLM providers
export const openrouterApiKey = persisted<string>('openrouterApiKey', '', { encrypt, decrypt });
export const openaiApiKey = persisted<string>('openaiApiKey', '', { encrypt, decrypt });
export const anthropicApiKey = persisted<string>('anthropicApiKey', '', { encrypt, decrypt });
export const geminiApiKey = persisted<string>('geminiApiKey', '', { encrypt, decrypt });
export const xaiApiKey = persisted<string>('xaiApiKey', '', { encrypt, decrypt });

// Custom LLM providers
export const providers = persisted<CustomLLMProvider[]>('providers', [], {
  encrypt: (providers) => providers.map((p) => ({ ...p, apiKey: encrypt(p.apiKey) })),
  decrypt: (providers) => providers.map((p) => ({ ...p, apiKey: decrypt(p.apiKey) }))
});
