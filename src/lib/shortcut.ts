import { execute } from '$lib/executor';
import { matchAll, matchOne } from '$lib/matcher';
import { shortcuts } from '$lib/stores.svelte';
import type { Rule } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DBCLICK_SHORTCUT, DRAG_SHORTCUT, LONG_PRESS_SHORTCUT, SHIFT_CLICK_SHORTCUT } from './constants';
import { isMouseShortcut } from './helpers';

/** Map mouse shortcut string to the backend command that enables/disables it. */
function getMouseTriggerCommand(shortcut: string): string | null {
  if (shortcut === DRAG_SHORTCUT) return 'set_mouse_drag_trigger';
  if (shortcut === DBCLICK_SHORTCUT) return 'set_mouse_dbclick_trigger';
  if (shortcut === SHIFT_CLICK_SHORTCUT) return 'set_mouse_shift_trigger';
  return null;
}

/**
 * Push the current effective state of a mouse shortcut to the backend.
 * Effective = has at least one rule AND not disabled.
 * Safe to call for any shortcut; non-mouse shortcuts are ignored.
 */
export async function syncMouseTrigger(shortcut: string): Promise<void> {
  const cmd = getMouseTriggerCommand(shortcut);
  if (!cmd) return;
  const s = shortcuts.current[shortcut];
  const enabled = !!s && !s.disabled && Array.isArray(s.rules) && s.rules.length > 0;
  try {
    await invoke(cmd, { enabled });
  } catch (error) {
    console.error(`Failed to sync mouse trigger for ${shortcut}: ${error}`);
  }
}

/**
 * Update case ID in rules with given prefix.
 *
 * @param prefix - case ID prefix
 * @param caseId - current case ID
 * @param newCaseId - new case ID
 */
export function updateCaseId(prefix: string, caseId: string, newCaseId: string) {
  for (const shortcut in shortcuts.current) {
    const s = shortcuts.current[shortcut];
    if (s && s.rules) {
      for (const rule of s.rules) {
        if (rule.case === `${prefix}${caseId}`) {
          rule.case = `${prefix}${newCaseId}`;
        }
      }
    }
  }
}

/**
 * Update action ID in rules with given prefix.
 *
 * @param prefix - action ID prefix
 * @param actionId - current action ID
 * @param newActionId - new action ID
 */
export function updateActionId(prefix: string, actionId: string, newActionId: string) {
  for (const shortcut in shortcuts.current) {
    const s = shortcuts.current[shortcut];
    if (s && s.rules) {
      for (const rule of s.rules) {
        if (rule.action === `${prefix}${actionId}`) {
          rule.action = `${prefix}${newActionId}`;
        }
      }
    }
  }
}

/**
 * Shortcut manager class.
 */
export class Manager {
  constructor() {
    this.initialize();
  }

  /**
   * Initialize event listeners.
   */
  private async initialize(): Promise<void> {
    if (getCurrentWindow().label === 'main') {
      try {
        // listen for shortcut triggered events from Rust backend
        await listen('shortcut', async (event) => {
          const payload = event.payload as { shortcut: string; selection: string };
          await this.handleShortcutEvent(payload.shortcut, payload.selection);
        });
      } catch (error) {
        console.error(`Failed to initialize shortcut event listener: ${error}`);
      }
    }
  }

  /**
   * Handle shortcut event.
   *
   * @param shortcut - triggered shortcut string
   * @param selection - selected text
   */
  private async handleShortcutEvent(shortcut: string, selection: string): Promise<void> {
    try {
      // handle long press shortcut
      if (LONG_PRESS_SHORTCUT === shortcut) {
        const payload = JSON.stringify({ rules: [{ action: 'paste', shortcut }], selection });
        await invoke('show_toolbar', { payload, mouse: true });
        return;
      }

      // get all rules bound to this shortcut
      const s = shortcuts.current[shortcut];
      if (!s || s.disabled || !s.rules || s.rules.length === 0) {
        return;
      }

      if (s.mode === 'toolbar') {
        // find all matching rules
        const rules = await matchAll(selection, s.rules);
        if (rules.length === 0) {
          console.warn('No matching rules found');
          return;
        }
        // show toolbar window
        const payload = JSON.stringify({ rules, selection });
        const mouse = isMouseShortcut(shortcut);
        if (mouse) {
          await invoke('show_toolbar', { payload, mouse });
        } else {
          // slight delay to ensure keyboard event has fully processed
          setTimeout(async () => {
            await invoke('show_toolbar', { payload, mouse });
          }, 100);
        }
      } else {
        // find first matching rule
        const rule = await matchOne(selection, s.rules);
        if (rule === null) {
          console.warn('No matching rule found');
          return;
        }
        // execute action immediately
        rule.preview = false;
        await execute(rule, selection);
      }
    } catch (error) {
      console.error(`Failed to handle shortcut event: ${error}`);
    }
  }

  /**
   * Register rule.
   *
   * @param rule - rule object
   */
  async register(rule: Rule): Promise<void> {
    try {
      const shortcut = rule.shortcut;
      if (!isMouseShortcut(shortcut)) {
        // check if backend shortcut is registered
        const isRegistered = await invoke('is_shortcut_registered', { shortcut });
        if (!isRegistered) {
          // register backend shortcut with full shortcut string
          await invoke('register_shortcut', { shortcut });
        }
      }
      // save rule to frontend registry
      const s = shortcuts.current[shortcut];
      if (s && s.rules && !s.rules.find((r) => r.id === rule.id)) {
        s.rules.push(rule);
        // sync backend mouse trigger flag (no-op for keyboard shortcuts)
        await syncMouseTrigger(shortcut);
      }
    } catch (error) {
      console.error(`Failed to register rule: ${error}`);
      throw error;
    }
  }

  /**
   * Unregister rule.
   *
   * @param rule - rule object
   */
  async unregister(rule: Rule): Promise<void> {
    try {
      const shortcut = rule.shortcut;
      // remove rule from frontend registry
      const s = shortcuts.current[shortcut];
      if (s && s.rules) {
        const index = s.rules.findIndex((r) => r.id === rule.id);
        if (index !== -1) {
          s.rules.splice(index, 1);
        }
        // sync backend mouse trigger flag (no-op for keyboard shortcuts)
        await syncMouseTrigger(shortcut);
        // unregister keyboard shortcut at backend when last rule removed
        if (!isMouseShortcut(shortcut) && s.rules.length === 0) {
          await invoke('unregister_shortcut', { shortcut });
        }
      }
    } catch (error) {
      console.error(`Failed to unregister rule: ${error}`);
      throw error;
    }
  }
}

// export singleton instance
export const manager = new Manager();
