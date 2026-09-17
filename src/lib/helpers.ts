import { DBCLICK_SHORTCUT, DRAG_SHORTCUT, SHIFT_CLICK_SHORTCUT, TRIPLE_CLICK_SHORTCUT } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { getLocale, locales, type Locale } from '$lib/paraglide/runtime';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { exists, writeTextFile } from '@tauri-apps/plugin-fs';
import { type } from '@tauri-apps/plugin-os';
import type { ActionReturn } from 'svelte/action';
import type { Instance, Props } from 'tippy.js';
import tippy from 'tippy.js';

// operating system type
const osType = type();

// mapping of special key codes to display representations
const KBD_LABEL_MAP: Record<string, string> = {
  // modifier keys
  Meta: osType === 'macos' ? '⌘' : 'Win',
  Control: '⌃',
  Alt: osType === 'macos' ? '⌥' : 'Alt',
  Shift: '⇧',
  // whitespace keys
  Enter: '↵',
  Tab: '⇥',
  // navigation keys
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  // editing keys
  Backspace: '⌫',
  Delete: 'Del',
  Insert: 'Ins',
  // UI keys
  Escape: 'Esc',
  // symbol keys
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/'
};

/**
 * Get display representation of a key code.
 *
 * @param code - key code
 * @returns display representation
 */
export function getKbdLabel(code: string): string {
  const label = KBD_LABEL_MAP[code];
  if (label) {
    return label;
  }
  if (code.startsWith('Key')) {
    return code.slice(3);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  return code;
}

/**
 * Check if the shortcut is a mouse shortcut.
 *
 * @param shortcut - shortcut string
 * @returns true if mouse shortcut, false otherwise
 */
export function isMouseShortcut(shortcut: string): boolean {
  return (
    shortcut === DRAG_SHORTCUT ||
    shortcut === DBCLICK_SHORTCUT ||
    shortcut === TRIPLE_CLICK_SHORTCUT ||
    shortcut === SHIFT_CLICK_SHORTCUT
  );
}

/**
 * Format shortcut string.
 *
 * @param shortcut - shortcut string (e.g., "Meta+Shift+KeyA")
 * @returns formatted shortcut string (e.g., "⌘+⇧+A" on macOS)
 */
export function formatShortcut(shortcut: string): string {
  if (shortcut === DRAG_SHORTCUT) {
    return m.mouse_drag();
  } else if (shortcut === DBCLICK_SHORTCUT) {
    return m.mouse_dbclick();
  } else if (shortcut === TRIPLE_CLICK_SHORTCUT) {
    return m.mouse_triple_click();
  } else if (shortcut === SHIFT_CLICK_SHORTCUT) {
    return m.mouse_shift_click();
  }
  return shortcut
    .split('+')
    .map((code) => getKbdLabel(code))
    .join(' + ');
}

/**
 * Format ISO8601 datetime string.
 *
 * @param str - ISO8601 format datetime string
 * @returns formatted datetime string
 */
export function formatISO8601(str: string | null | undefined): string {
  if (!str) {
    return '';
  }
  const datetime = new Date(str);
  return datetime.toLocaleString(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
}

/**
 * Create tooltip using Tippy.js.
 *
 * @param target - target element
 * @param props - tooltip properties
 * @returns svelte action return value
 */
export function tooltip(target: HTMLElement, props: Partial<Props>): ActionReturn<Partial<Props>> {
  let instance: Instance | null = null;
  if (props && props.content) {
    // check if target element is inside dialog element
    let el: HTMLElement | null = target;
    while (el && el.nodeName !== 'DIALOG') {
      el = el.parentElement;
    }
    const dialog = el as HTMLDialogElement | null;
    if (dialog) {
      // set appendTo property to dialog element
      props.appendTo = dialog;
    }
    // create tooltip instance
    if (props.followCursor && !props.theme) {
      props.theme = 'follow-cursor';
    }
    instance = tippy(target, props);
  }
  return {
    update: (props) => {
      if (props && props.content) {
        if (instance) {
          instance.setProps(props);
        } else {
          instance = tippy(target, props);
        }
      } else if (instance) {
        instance.destroy();
        instance = null;
      }
    },
    destroy: () => {
      if (instance) {
        instance.destroy();
      }
    }
  };
}

/**
 * Setup tray menu language.
 */
export async function setupTray(locale: Locale = getLocale()) {
  try {
    await invoke('set_tray_locale', { locale });
  } catch (error) {
    console.error(`Failed to setup tray menu language: ${error}`);
  }
}

/**
 * Serialize extension to JSON string.
 *
 * @param extension - extension object
 * @returns JSON string
 */
export function dumpExtension<T extends { id: string }>(extension: T): string {
  const { id, ...rest } = extension;
  return JSON.stringify(
    {
      ...rest,
      locales: Object.fromEntries(
        locales.map((locale) => [
          locale,
          {
            name: locale === getLocale() ? id : '',
            description: '',
            tags: []
          }
        ])
      ),
      sort: Date.now()
    },
    null,
    2
  );
}

/**
 * Export one extension to a chosen file or multiple extensions to a chosen directory.
 *
 * @param items - extensions to export in list order
 * @returns true if all files are exported, false if the selection is empty or export is canceled
 * @throws if serialization, dialog or file operations fail
 */
export async function exportExtensions<T extends { id: string }>(items: T[]): Promise<boolean> {
  if (!items.length) {
    return false;
  }
  const filters = [{ name: 'JSON', extensions: ['json'] }];
  // serialize before opening a dialog so later edits cannot change the exported data
  const files = items.map((item) => ({ id: item.id, contents: dumpExtension(item) }));
  if (files.length === 1) {
    const path = await save({ defaultPath: `${files[0].id}.json`, filters });
    if (!path) {
      return false;
    }
    await writeTextFile(path, files[0].contents);
    return true;
  }

  const directory = await open({
    title: m.export_count({ count: files.length }),
    directory: true,
    multiple: false
  });
  if (!directory) {
    return false;
  }
  for (const file of files) {
    // keep generated filenames valid on both macOS and Windows
    const name =
      Array.from(file.id, (char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('')
        .replace(/^[. ]+|[. ]+$/g, '') || 'extension';
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
    let path = await join(directory, `${reserved ? '_' : ''}${name}.json`);
    const conflict = await exists(path);
    if (conflict) {
      // use the native save dialog to rename files or confirm overwriting
      const replacement = await save({ defaultPath: path, filters });
      if (!replacement) {
        return false;
      }
      path = replacement;
    }
    // preserve the original ID when filename cleanup or renaming changes the filename
    const contents = JSON.stringify({ id: file.id, ...JSON.parse(file.contents) }, null, 2);
    await writeTextFile(path, contents, { createNew: !conflict });
  }
  return true;
}
