import { createExecutionGuard, execute } from '$lib/executor';
import { shortcuts } from '$lib/stores.svelte';
import type { Rule } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LONG_PRESS_SHORTCUT } from './constants';
import { isMouseShortcut } from './helpers';

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
   * @returns promise resolving after matching/execution; superseded selections are discarded
   */
  private async handleShortcutEvent(shortcut: string, selection: string): Promise<void> {
    try {
      const isCurrent = createExecutionGuard();
      await shortcuts.ready;
      if (!isCurrent()) return;

      // handle long press shortcut
      if (LONG_PRESS_SHORTCUT === shortcut) {
        const payload = JSON.stringify({ rules: [{ action: 'paste', shortcut }], selection, mouse: true });
        await invoke('show_toolbar', { payload, mouse: true });
        return;
      }

      // get all rules bound to this shortcut
      const s = shortcuts.current[shortcut];
      if (!s || s.disabled || !s.rules || s.rules.length === 0) {
        return;
      }

      // fetch selection for mouse shortcuts if not provided
      const mouse = isMouseShortcut(shortcut);
      if (mouse && !selection.trim()) {
        selection = await invoke<string>('get_selection', { mouse: true });
        if (!isCurrent()) return;
        if (!selection.trim()) {
          return;
        }
      }

      const { matchAll, matchOne } = await import('$lib/matcher');
      if (!isCurrent()) return;
      if (s.mode === 'toolbar') {
        // find all matching rules
        const rules = await matchAll(selection, s.rules);
        if (!isCurrent()) return;
        if (rules.length === 0) {
          console.warn('No matching rules found');
          return;
        }
        // show toolbar window
        const payload = JSON.stringify({ rules, selection, mouse });
        if (mouse) {
          await invoke('show_toolbar', { payload, mouse });
        } else {
          // slight delay to ensure keyboard event has fully processed
          setTimeout(async () => {
            if (!isCurrent()) return;
            try {
              await invoke('show_toolbar', { payload, mouse });
            } catch (error) {
              console.error(`Failed to show toolbar: ${error}`);
            }
          }, 100);
        }
      } else {
        // find first matching rule
        const rule = await matchOne(selection, s.rules);
        if (!isCurrent()) return;
        if (rule === null) {
          console.warn('No matching rule found');
          return;
        }
        // execute action immediately
        rule.preview = false;
        await execute(rule, selection, undefined, isCurrent);
      }
    } catch (error) {
      console.error(`Failed to handle shortcut event: ${error}`);
    }
  }

  /**
   * Enable or disable a shortcut group.
   *
   * @param shortcut - shortcut string
   * @param enabled - whether the shortcut should be enabled
   */
  async setEnabled(shortcut: string, enabled: boolean): Promise<void> {
    try {
      const s = shortcuts.current[shortcut];
      if (!s) {
        return;
      }

      if (!isMouseShortcut(shortcut) && s.rules.length > 0) {
        const isRegistered = await invoke('is_shortcut_registered', { shortcut });
        if (enabled && !isRegistered) {
          await invoke('register_shortcut', { shortcut });
        } else if (!enabled && isRegistered) {
          await invoke('unregister_shortcut', { shortcut });
        }
      }

      s.disabled = !enabled;
    } catch (error) {
      console.error(`Failed to update shortcut state: ${error}`);
      throw error;
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
      const s = shortcuts.current[shortcut];
      if (!isMouseShortcut(shortcut) && !s?.disabled) {
        // check if backend shortcut is registered
        const isRegistered = await invoke('is_shortcut_registered', { shortcut });
        if (!isRegistered) {
          // register backend shortcut with full shortcut string
          await invoke('register_shortcut', { shortcut });
        }
      }
      // save rule to frontend registry
      if (s && s.rules && !s.rules.find((r) => r.id === rule.id)) {
        s.rules.push(rule);
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
        // unregister backend shortcut when no remaining rules
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
