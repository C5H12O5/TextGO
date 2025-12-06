<script lang="ts">
  import { PROMPT_MARK, SCRIPT_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, execute, GENERAL_ACTIONS, PROCESS_ACTIONS, DEFAULT_ACTIONS } from '$lib/executor';
  import { prompts, scripts } from '$lib/stores.svelte';
  import type { Rule } from '$lib/types';
  import { LogicalSize } from '@tauri-apps/api/dpi';
  import { listen } from '@tauri-apps/api/event';
  import { Menu, MenuItem } from '@tauri-apps/api/menu';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { IconComponentProps } from 'phosphor-svelte';
  import { Code, DotsThree, Robot } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';

  type ActionItem = {
    id: string;
    label: string;
    icon?: Component<IconComponentProps>;
    rule: Rule;
  };

  // matched actions to display
  let actions: ActionItem[] = $state([]);

  // maximum actions to show before dropdown
  const MAX_VISIBLE_ACTIONS = 6;

  // visible and overflow actions
  let visibleActions = $derived(actions.slice(0, MAX_VISIBLE_ACTIONS));
  let overflowActions = $derived(actions.slice(MAX_VISIBLE_ACTIONS));

  // selected text
  let selection: string = $state('');

  // main element reference
  let mainElement: HTMLElement;

  // track if mouse is inside toolbar
  let isMouseInside = $state(true);

  /**
   * Update toolbar with matched rules.
   */
  function updateToolbar(data: { rules: Rule[]; selection: string }) {
    if (!data || !data.rules || !Array.isArray(data.rules)) {
      return;
    }

    selection = data.selection || '';
    const items: ActionItem[] = [];

    data.rules.forEach((rule) => {
      const actionId = rule.action;

      if (actionId.startsWith(SCRIPT_MARK)) {
        const scriptId = actionId.substring(SCRIPT_MARK.length);
        const script = scripts.current.find((s) => s.id === scriptId);
        if (script) {
          items.push({
            id: actionId,
            label: scriptId,
            icon: Code,
            rule
          });
        }
      } else if (actionId.startsWith(PROMPT_MARK)) {
        const promptId = actionId.substring(PROMPT_MARK.length);
        const prompt = prompts.current.find((p) => p.id === promptId);
        if (prompt) {
          items.push({
            id: actionId,
            label: promptId,
            icon: Robot,
            rule
          });
        }
      } else {
        // built-in action
        const builtinAction = [...DEFAULT_ACTIONS, ...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find(
          (a) => a.value === actionId
        );
        if (builtinAction) {
          items.push({
            id: actionId,
            label: builtinAction.label,
            icon: builtinAction.icon,
            rule
          });
        }
      }
    });

    actions = items;

    // Resize window to fit content after actions are updated
    setTimeout(async () => {
      if (mainElement) {
        try {
          // Get the actual content size (first child element)
          const contentElement = mainElement.firstElementChild as HTMLElement;
          if (contentElement) {
            const rect = contentElement.getBoundingClientRect();
            const currentWindow = getCurrentWindow();

            // Use logical size directly
            console.info(`Resizing window to width: ${rect.width}, height: ${rect.height}`);
            await currentWindow.setSize(new LogicalSize(rect.width, rect.height));
          }
        } catch (error) {
          console.error(`Failed to resize window: ${error}`);
        }
      }
    }, 0);
  }

  /**
   * Handle action click - execute the selected action.
   */
  async function handleActionClick(action: ActionItem) {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.hide();
      await execute(action.rule, selection);
    } catch (error) {
      console.error(`Failed to execute action: ${error}`);
    }
  }

  /**
   * Show overflow menu using system context menu.
   */
  async function showOverflowMenu() {
    try {
      // Create menu items
      const menuItems = await Promise.all(
        overflowActions.map(async (action) => {
          return await MenuItem.new({
            id: action.id,
            text: action.label,
            action: () => handleActionClick(action)
          });
        })
      );

      // Create menu
      const menu = await Menu.new({
        items: menuItems
      });

      // Show popup menu at cursor
      const currentWindow = getCurrentWindow();
      await menu.popup(undefined, currentWindow);
    } catch (error) {
      console.error(`Failed to show overflow menu: ${error}`);
    }
  }

  onMount(() => {
    // listen to toolbar update events
    const unlisten = listen<string>('show-toolbar', (event) => {
      try {
        // Parse the JSON payload
        console.info(`Received toolbar data: ${event.payload}`);
        const data = JSON.parse(event.payload);
        updateToolbar(data);
      } catch (error) {
        console.error(`Failed to parse toolbar data: ${error}`);
      }
    });

    // listen to panel mouse exited event to clear hover states
    const unlistenMouseExited = listen('toolbar-exited', () => {
      isMouseInside = false;
    });

    const unlistenMouseEntered = listen('toolbar-entered', () => {
      isMouseInside = true;
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenMouseExited.then((fn) => fn());
      unlistenMouseEntered.then((fn) => fn());
    };
  });
</script>

<main bind:this={mainElement} class="flex size-full bg-transparent">
  <div class="flex gap-2 rounded-box border bg-base-100/95 backdrop-blur-sm">
    {#if actions.length > 0}
      {#each visibleActions as action (action.id)}
        <button
          class="action-button flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200"
          class:can-hover={isMouseInside}
          onclick={() => handleActionClick(action)}
          title={action.label}
        >
          {#if action.icon}
            <action.icon class="size-4 shrink-0" weight="bold" />
          {/if}
          <span class="max-w-[120px] truncate text-sm font-medium">{action.label}</span>
        </button>
      {/each}
      {#if overflowActions.length > 0}
        <button class="btn min-h-0 px-2 btn-ghost btn-sm" onclick={showOverflowMenu}>
          <DotsThree class="size-4" weight="bold" />
        </button>
      {/if}
    {/if}
  </div>
</main>

<style>
  :global {
    html,
    body {
      background: transparent;
    }

    .action-button.can-hover:hover {
      background-color: var(--color-base-200);
      color: var(--color-primary);
      box-shadow:
        0 4px 6px -1px rgb(0 0 0 / 0.1),
        0 2px 4px -2px rgb(0 0 0 / 0.1);
    }
  }
</style>
