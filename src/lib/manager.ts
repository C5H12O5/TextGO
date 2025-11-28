import { execute } from '$lib/executor';
import { matchOne, matchAll } from '$lib/matcher';
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
      const rules = shortcuts.current[shortcut];
      if (!rules || rules.length === 0) {
        return;
      }
      // match the action to execute
      const rule = await matchOne(selection, rules);
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
   * Show toolbar with all matched actions for the given text.
   *
   * @param shortcut - triggered shortcut string
   * @param selection - selected text
   */
  async showToolbar(shortcut: string, selection: string): Promise<void> {
    try {
      // get all rules bound to this shortcut
      const rules = shortcuts.current[shortcut];
      if (!rules || rules.length === 0) {
        return;
      }

      // find all matching rules
      const matchedRules = await matchAll(selection, rules);

      if (matchedRules.length === 0) {
        console.warn('No matching rules found');
        return;
      }

      // prepare payload with matched rules and selection
      const payload = JSON.stringify({
        rules: matchedRules,
        selection: selection
      });

      // show toolbar window
      await invoke('show_toolbar', { payload });
    } catch (error) {
      console.error(`Failed to show toolbar: ${error}`);
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
      const isRegistered = await invoke('is_shortcut_registered', { shortcut: rule.shortcut });
      if (!isRegistered) {
        // register backend shortcut with full shortcut string
        await invoke('register_shortcut', { shortcut: rule.shortcut });
      }
      // save rule to frontend registry
      const rules = shortcuts.current[rule.shortcut];
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
      const rules = shortcuts.current[rule.shortcut];
      if (rules) {
        const index = rules.findIndex((r) => r.id === rule.id);
        if (index !== -1) {
          rules.splice(index, 1);
        }
        // unregister backend shortcut when no remaining rules
        if (rules.length === 0) {
          await invoke('unregister_shortcut', { shortcut: rule.shortcut });
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
