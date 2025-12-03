import { DBCLICK_SHORTCUT, DRAG_SHORTCUT } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
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
 * Format shortcut string.
 *
 * @param shortcut - shortcut string (e.g., "Meta+Shift+KeyA")
 * @returns formatted shortcut string (e.g., "⌘+⇧+A" on macOS)
 */
export function formatShortcut(shortcut: string): string {
  if (shortcut === DBCLICK_SHORTCUT) {
    return m.mouse_dbclick();
  } else if (shortcut === DRAG_SHORTCUT) {
    return m.mouse_drag();
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
 * Check if the shortcut is a mouse shortcut.
 *
 * @param shortcut - shortcut string
 * @returns true if mouse shortcut, false otherwise
 */
export function isMouseShortcut(shortcut: string): boolean {
  return shortcut === DBCLICK_SHORTCUT || shortcut === DRAG_SHORTCUT;
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
