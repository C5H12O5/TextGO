import { execute } from '$lib/executor';
import { matchAll, matchOne } from '$lib/matcher';
import { shortcuts } from '$lib/stores.svelte';
import type { Rule } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
   */
  private async handleShortcutEvent(shortcut: string, selection: string): Promise<void> {
    try {
      // get all rules bound to this shortcut
      const s = shortcuts.current[shortcut];
      if (!s || !s.rules || s.rules.length === 0) {
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
