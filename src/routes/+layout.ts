import { m } from '$lib/paraglide/messages';
import * as stores from '$lib/stores.svelte';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log';
import tippy, { followCursor } from 'tippy.js';
import type { LayoutLoad } from './$types';

// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
export const ssr = false;

export const load: LayoutLoad = async () => {
  // forward console logs to Tauri logger plugin
  forwardConsole('log', trace);
  forwardConsole('debug', debug);
  forwardConsole('info', info);
  forwardConsole('warn', warn);
  forwardConsole('error', error);

  // set default properties for Tippy.js globally
  // https://atomiks.github.io/tippyjs/v6/methods/#setdefaultprops
  tippy.setDefaultProps({
    zIndex: 100,
    maxWidth: 300,
    arrow: false,
    theme: 'default',
    animation: 'scale',
    placement: 'bottom',
    trigger: 'mouseenter',
    plugins: [followCursor]
  });

  // initialize tray menu language
  if (getCurrentWindow().label === 'main') {
    try {
      await invoke('setup_tray', {
        shortcutsText: m.tray_shortcuts(),
        historiesText: m.tray_histories(),
        settingsText: m.tray_settings(),
        aboutText: m.tray_about(),
        quitText: m.tray_quit()
      });
    } catch (error) {
      console.error(`Failed to initialize tray menu language: ${error}`);
    }
  }

  // initialize all stores immediately on import
  return { stores };
};

/**
 * Forward console method to specified logger
 *
 * @param fnName - console method name
 * @param logger - logger function
 */
function forwardConsole(
  fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
  logger: (message: string) => Promise<void>
) {
  const original = console[fnName];
  console[fnName] = (message) => {
    original(message);
    logger(message);
  };
}
