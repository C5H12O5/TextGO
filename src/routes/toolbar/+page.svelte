<script lang="ts">
  import { PROMPT_MARK, SCRIPT_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, execute, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import { prompts, scripts } from '$lib/stores.svelte';
  import type { Rule } from '$lib/types';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { IconComponentProps } from 'phosphor-svelte';
  import { Code, Robot } from 'phosphor-svelte';
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

  // selected text
  let selection: string = $state('');

  /**
   * Update toolbar with matched rules.
   */
  function updateToolbar(data: { rules: Rule[]; selection: string }) {
    if (!data || !data.rules || !Array.isArray(data.rules)) {
      console.error('Invalid toolbar data:', data);
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
        const builtinAction = [...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find(
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
      console.error('Failed to execute action:', error);
    }
  }

  onMount(() => {
    // listen to toolbar update events
    const unlisten = listen<string>('show-toolbar', (event) => {
      try {
        // Parse the JSON payload
        const data = JSON.parse(event.payload);
        updateToolbar(data);
      } catch (error) {
        console.error('Failed to parse toolbar data:', error);
      }
    });

    listen('dbclick', (event) => {
      console.info(`Double clicked text: ${event.payload}`);
    });

    listen('dragend', (event) => {
      console.info(`Drag ended with text: ${event.payload}`);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  });
</script>

<main class="flex size-full bg-transparent">
  {#if actions.length > 0}
    <div class="flex h-8 cursor-pointer items-center gap-2 rounded-lg border p-2 backdrop-blur-sm">
      {#each actions as action (action.id)}
        <button
          class="flex cursor-pointer items-center gap-1.5 rounded-md transition-all duration-200 hover:bg-primary hover:text-primary-content hover:shadow-md"
          onclick={() => handleActionClick(action)}
          title={action.label}
        >
          {#if action.icon}
            <action.icon class="size-4 shrink-0" weight="bold" />
          {/if}
          <span class="max-w-[120px] truncate text-sm font-medium">{action.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</main>

<!-- <style>
  :global {
    html,
    body {
      background: transparent;
    }
  }
</style> -->
