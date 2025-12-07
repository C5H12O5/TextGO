<script lang="ts">
  import { Icon } from '$lib/components';
  import { PROMPT_MARK, SCRIPT_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, DEFAULT_ACTIONS, execute, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import { prompts, scripts } from '$lib/stores.svelte';
  import type { Rule } from '$lib/types';
  import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
  import { listen } from '@tauri-apps/api/event';
  import { Image } from '@tauri-apps/api/image';
  import { IconMenuItem, Menu } from '@tauri-apps/api/menu';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { type } from '@tauri-apps/plugin-os';
  import { memoize } from 'es-toolkit/function';
  import type { IconComponentProps } from 'phosphor-svelte';
  import { Code, DotsThreeVertical, LineVertical, Robot } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  import { mount, onMount, tick, unmount } from 'svelte';

  // maximum visible actions in toolbar
  const MAX_VISIBLE_ACTIONS = 6;

  // operating system type
  const osType = type();

  // main container
  let container: HTMLDivElement;

  // current text selection
  let selection: string = $state('');

  // track if mouse is inside toolbar
  let mouseEntered = $state(true);

  // toolbar action type
  type Action = {
    id: string;
    icon?: Component<IconComponentProps> | string;
    label: string;
    rule: Rule;
  };

  // matched actions to display
  let actions: Action[] = $state([]);
  let visibleActions: Action[] = $derived(actions.slice(0, MAX_VISIBLE_ACTIONS));
  let overflowActions: Action[] = $derived(actions.slice(MAX_VISIBLE_ACTIONS));

  // memoized lookup function
  const findBuiltinAction = memoize((action: string) =>
    [...DEFAULT_ACTIONS, ...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find((a) => a.value === action)
  );

  /**
   * Setup toolbar with given rules and selection.
   *
   * @param data - toolbar setup data
   */
  function setup(data: { rules: Rule[]; selection: string }) {
    if (!data || !data.rules || !Array.isArray(data.rules)) {
      return;
    }

    // update current selection
    selection = data.selection || '';

    // map rules to actions
    actions = data.rules
      .map((rule) => {
        const actionId = rule.action;

        if (actionId.startsWith(SCRIPT_MARK)) {
          // script action
          const scriptId = actionId.substring(SCRIPT_MARK.length);
          const script = scripts.current.find((s) => s.id === scriptId);
          if (script) {
            return {
              id: actionId,
              icon: script.icon || Code,
              label: scriptId,
              rule: rule
            };
          }
        } else if (actionId.startsWith(PROMPT_MARK)) {
          // prompt action
          const promptId = actionId.substring(PROMPT_MARK.length);
          const prompt = prompts.current.find((p) => p.id === promptId);
          if (prompt) {
            return {
              id: actionId,
              icon: prompt.icon || Robot,
              label: promptId,
              rule: rule
            };
          }
        } else {
          // built-in action
          const builtin = findBuiltinAction(actionId);
          if (builtin) {
            return {
              id: actionId,
              icon: builtin.icon,
              label: builtin.label,
              rule: rule
            };
          }
        }
      })
      .filter((a) => !!a);

    // resize window to fit content after actions are updated
    tick().then(() => {
      if (container) {
        try {
          // get container size
          const rect = container.getBoundingClientRect();
          const currentWindow = getCurrentWindow();
          // set window size with some padding
          currentWindow.setSize(new LogicalSize(rect.width + 10, rect.height + 10));
          // show window after resize
          currentWindow.show();
        } catch (error) {
          console.error(`Failed to resize window: ${error}`);
        }
      }
    });
  }

  /**
   * Show more actions in overflow menu.
   */
  async function showMoreActions() {
    try {
      // create menu items with icons
      const menu = await Menu.new({
        items: await Promise.all(
          overflowActions.map(async (action) => {
            return await IconMenuItem.new({
              id: action.id,
              text: action.label,
              icon: await iconToImage(action.icon),
              action: () => executeAction(action)
            });
          })
        )
      });

      // get current window
      const currentWindow = getCurrentWindow();

      // calculate bottom-right corner position
      const size = await currentWindow.innerSize();
      const bottomRightPosition = new LogicalPosition(size.width - 32, size.height + 2);

      // popup menu at bottom-right corner of toolbar window
      await menu.popup(bottomRightPosition, currentWindow);
    } catch (error) {
      console.error(`Failed to show more actions menu: ${error}`);
    }
  }

  /**
   * Convert icon component or base64 string to menu item image.
   *
   * @param icon - action icon
   */
  async function iconToImage(icon: Component<IconComponentProps> | string | undefined): Promise<Image | undefined> {
    if (!icon) {
      return undefined;
    }

    // create a temporary container to render the icon
    const tempElement = document.createElement('div');

    // render the Icon component using mount function
    const iconComponent = mount(Icon, {
      target: tempElement,
      props: { icon }
    });

    // wait for rendering to complete
    await tick();

    try {
      // get the svg or img element
      const svg = tempElement.querySelector('svg');
      const img = tempElement.querySelector('img');
      if (!svg && !img) {
        return undefined;
      }

      // set fill color for SVG icons
      if (svg && osType === 'macos') {
        // detect if system is in dark mode
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        svg.style.color = isDark ? '#ffffff' : '#000000';
      }

      // create URL for the icon
      let url: string;
      if (svg) {
        // handle SVG element
        const svgData = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        url = URL.createObjectURL(svgBlob);
      } else if (img) {
        // handle base64 image
        url = img.src;
      } else {
        return undefined;
      }

      // create canvas to draw the icon
      const canvas = document.createElement('canvas');
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        if (svg) {
          URL.revokeObjectURL(url);
        }
        return undefined;
      }

      // load image from URL
      const imageEl = new window.Image();
      await new Promise<void>((resolve, reject) => {
        imageEl.onload = () => resolve();
        imageEl.onerror = reject;
        imageEl.src = url;
      });

      // cleanup URL object
      if (svg) {
        URL.revokeObjectURL(url);
      }

      // draw image onto canvas
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(imageEl, 0, 0, size, size);

      // get RGBA pixel data
      const imageData = ctx.getImageData(0, 0, size, size);
      const rgbaBytes = new Uint8Array(imageData.data);

      // create menu item image from pixel data
      return await Image.new(rgbaBytes, size, size);
    } catch (error) {
      console.error(`Failed to convert icon to Image: ${error}`);
      return undefined;
    } finally {
      // cleanup component and temp container
      unmount(iconComponent);
      tempElement.remove();
    }
  }

  /**
   * Handle action click event.
   *
   * @param action - toolbar action
   */
  async function executeAction(action: Action) {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.hide();
      await execute(action.rule, selection);
    } catch (error) {
      console.error(`Failed to execute action: ${error}`);
    }
  }

  onMount(() => {
    // listen to toolbar update events
    const unlisten = listen<string>('show-toolbar', (event) => {
      setup(JSON.parse(event.payload));
    });

    // listen to panel mouse events
    const unlistenMouseEntered = listen('toolbar-entered', () => {
      mouseEntered = true;
    });
    const unlistenMouseExited = listen('toolbar-exited', () => {
      mouseEntered = false;
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenMouseExited.then((fn) => fn());
      unlistenMouseEntered.then((fn) => fn());
    };
  });
</script>

<main class="bg-transparent p-1 select-none">
  <div class="overflow-hidden rounded-box border shadow-sm">
    <div class="flex size-fit h-8 bg-base-200/95 backdrop-blur-sm" bind:this={container}>
      <span
        class="flex cursor-move items-center px-0.5 opacity-20 transition-opacity"
        class:hover:opacity-60={mouseEntered}
        data-tauri-drag-region
      >
        <LineVertical weight="bold" class="pointer-events-none size-4" />
      </span>
      {#if actions.length > 0}
        {#each visibleActions as action (action.id)}
          <button
            class="flex cursor-pointer items-center gap-1 px-1.5 transition-colors"
            class:hover:bg-btn-hover={mouseEntered}
            class:hover:text-primary={mouseEntered}
            onclick={() => executeAction(action)}
            title={action.label}
          >
            {#if action.icon}
              <Icon icon={action.icon} class="size-4 shrink-0" />
            {/if}
            <span class="max-w-30 truncate text-xs font-medium opacity-90">{action.label}</span>
          </button>
        {/each}
        {#if overflowActions.length > 0}
          <button
            class="h-8 cursor-pointer px-0.5 opacity-60 transition-all"
            class:hover:bg-btn-hover={mouseEntered}
            class:hover:opacity-100={mouseEntered}
            onclick={showMoreActions}
          >
            <DotsThreeVertical weight="bold" class="size-6" />
          </button>
        {/if}
      {/if}
    </div>
  </div>
</main>

<style>
  :global {
    html,
    body {
      background: transparent;
    }
  }
</style>
