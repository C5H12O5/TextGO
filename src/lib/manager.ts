import { execute } from '$lib/executor';
import { match } from '$lib/matcher';
import { shortcuts } from '$lib/stores.svelte';
import type { Rule } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
        await listen('shortcut-triggered', async (event) => {
          const payload = event.payload as { key: string; selection: string };
          // key now contains the full shortcut string
          await this.handleShortcutEvent(payload.key, payload.selection);
        });
      } catch (error) {
        console.error(`Failed to initialize shortcut event listener: ${error}`);
      }
    }
  }

  /**
   * Handle shortcut event.
   *
   * @param shortcutStr - triggered shortcut string (e.g., "Ctrl+Shift+A")
   * @param selection - selected text
   */
  private async handleShortcutEvent(shortcutStr: string, selection: string): Promise<void> {
    try {
      // get all rules bound to this shortcut
      const rules = shortcuts.current[shortcutStr];
      if (!rules || rules.length === 0) {
        return;
      }
      // match the action to execute
      const rule = await match(selection, rules);
      if (rule === null) {
        console.warn('No matching rule found');
        return;
      }
      // execute default action
      if (rule.action === '') {
        await invoke('show_main_window');
        return;
      }
      // execute action
      await execute(rule, selection);
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
      // check if backend shortcut is registered
      const isRegistered = await invoke('is_shortcut_registered', { shortcutStr: rule.key });
      if (!isRegistered) {
        // register backend shortcut with full shortcut string
        await invoke('register_shortcut', { shortcutStr: rule.key });
      }
      // save rule to frontend registry
      const rules = shortcuts.current[rule.key];
      if (rules && !rules.find((r) => r.id === rule.id)) {
        rules.push(rule);
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
      // remove rule from frontend registry
      const rules = shortcuts.current[rule.key];
      if (rules) {
        const index = rules.findIndex((r) => r.id === rule.id);
        if (index !== -1) {
          rules.splice(index, 1);
        }
        // unregister backend shortcut when no remaining rules
        if (rules.length === 0) {
          await invoke('unregister_shortcut', { shortcutStr: rule.key });
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
