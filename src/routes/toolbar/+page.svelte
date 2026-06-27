<script lang="ts">
  import { Icon } from '$lib/components';
  import {
    PROMPT_MARK,
    SCRIPT_MARK,
    SEARCHER_MARK,
    TOOLBAR_ACTION_COUNT,
    TOOLBAR_CORNER_RADIUS,
    TOOLBAR_OPACITY
  } from '$lib/constants';
  import { CONVERT_ACTIONS, DEFAULT_ACTIONS, execute, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import {
    prompts,
    scripts,
    searchers,
    toolbarCornerRadius,
    toolbarMaxActions,
    toolbarOpacity
  } from '$lib/stores.svelte';
  import type { Rule, WindowPlacement } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
  import { listen } from '@tauri-apps/api/event';
  import { Image } from '@tauri-apps/api/image';
  import { IconMenuItem, Menu } from '@tauri-apps/api/menu';
  import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
  import { type } from '@tauri-apps/plugin-os';
  import { memoize } from 'es-toolkit/function';
  import type { IconComponentProps } from 'phosphor-svelte';
  import { CodeIcon, DotsThreeVerticalIcon, LineVerticalIcon, MagnifyingGlassIcon, RobotIcon } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  import { mount, onMount, tick, unmount } from 'svelte';
  import { fly } from 'svelte/transition';

  // operating system type
  const osType = type();
  const isWindows = osType === 'windows';

  // bottom safe area offset to avoid taskbar/dock, aligned with Tauri window positioning
  const SAFE_AREA_BOTTOM = 80;

  // current window
  const currentWindow = getCurrentWindow();

  // toolbar initialized state
  let initialized = $state(false);

  // main container element
  let container: HTMLDivElement | null = $state(null);

  // current text selection
  let selection: string = $state('');

  // track if mouse is inside toolbar
  let mouseEntered = $state(true);

  // whether the toolbar is rendering as an HTML menu
  let menuMode = $state(false);

  // toolbar action type
  type Action = {
    id: string;
    icon?: Component<IconComponentProps> | string;
    label: string;
    rule: Rule;
  };

  // matched actions to display
  let actions: Action[] = $state([]);
  let maxVisibleActions = $derived.by(() => {
    const value = toolbarMaxActions.current;
    if (!Number.isFinite(value)) {
      return TOOLBAR_ACTION_COUNT.default;
    }
    return Math.min(TOOLBAR_ACTION_COUNT.max, Math.max(TOOLBAR_ACTION_COUNT.min, Math.trunc(value)));
  });
  let visibleActions: Action[] = $derived(actions.slice(0, maxVisibleActions));
  let overflowActions: Action[] = $derived(actions.slice(maxVisibleActions));

  // toolbar corner radius style
  let cornerRadiusStyle = $derived.by(() => {
    const value = toolbarCornerRadius.current;
    if (!Number.isFinite(value)) {
      return `${TOOLBAR_CORNER_RADIUS.default}px`;
    }
    const cornerRadius = Math.min(TOOLBAR_CORNER_RADIUS.max, Math.max(TOOLBAR_CORNER_RADIUS.min, Math.trunc(value)));
    return `${cornerRadius}px`;
  });

  // toolbar opacity value
  let toolbarOpacityValue = $derived.by(() => {
    const value = toolbarOpacity.current;
    return Number.isFinite(value)
      ? Math.min(TOOLBAR_OPACITY.max, Math.max(TOOLBAR_OPACITY.min, Math.trunc(value)))
      : TOOLBAR_OPACITY.default;
  });

  // toolbar background style
  let toolbarBackgroundStyle = $derived.by(() => {
    const opacity = toolbarOpacityValue;
    return `color-mix(in oklab, var(--color-base-200) ${opacity}%, transparent)`;
  });

  // action background style
  let actionBackgroundStyle = $derived.by(() => {
    const opacity = toolbarOpacityValue;
    const centerOpacity = Math.max(18, Math.round((100 - opacity) * 0.72));
    const middleOpacity = Math.round(centerOpacity * 0.42);
    const highlightOpacity = Math.round(centerOpacity * 0.18);
    const colorMix = (color: string, mixOpacity: number) => `color-mix(in oklab, ${color} ${mixOpacity}%, transparent)`;
    const highlightGradient = [
      'linear-gradient(to bottom',
      colorMix('var(--color-base-100)', highlightOpacity),
      'transparent 46%)'
    ].join(', ');
    const actionGlowGradient = [
      'radial-gradient(120% 95% at 50% 48%',
      `${colorMix('var(--color-base-200)', centerOpacity)} 0%`,
      `${colorMix('var(--color-base-200)', middleOpacity)} 48%`,
      'transparent 78%)'
    ].join(', ');
    return `${highlightGradient}, ${actionGlowGradient}`;
  });

  // custom action types
  let actionTypes = $derived([
    {
      mark: SCRIPT_MARK,
      collection: scripts.current,
      defaultIcon: CodeIcon
    },
    {
      mark: PROMPT_MARK,
      collection: prompts.current,
      defaultIcon: RobotIcon
    },
    {
      mark: SEARCHER_MARK,
      collection: searchers.current,
      defaultIcon: MagnifyingGlassIcon
    }
  ]);

  // memoized function to find built-in action
  const findBuiltinAction = memoize((action: string) =>
    [...DEFAULT_ACTIONS, ...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find((a) => a.value === action)
  );

  /**
   * Map rule to toolbar action.
   *
   * @param rule - rule object
   */
  function mapToAction(rule: Rule): Action | undefined {
    const actionId = rule.action;

    // check for custom action types
    for (const type of actionTypes) {
      if (actionId.startsWith(type.mark)) {
        const itemId = actionId.substring(type.mark.length);
        const item = type.collection.find((i) => i.id === itemId);
        if (item) {
          return {
            id: actionId,
            icon: item.icon || type.defaultIcon,
            label: itemId,
            rule: rule
          };
        }
      }
    }

    // check for built-in action
    const builtin = findBuiltinAction(actionId);
    if (builtin) {
      return {
        id: actionId,
        icon: builtin.icon,
        label: builtin.label,
        rule: rule
      };
    }

    return undefined;
  }

  /**
   * Setup toolbar with given rules and selection.
   *
   * @param data - toolbar setup data
   * @returns whether the toolbar window should be shown
   */
  async function setup(data: { rules: Rule[]; selection: string; mouse?: boolean }): Promise<boolean> {
    menuMode = false;

    if (!data || !data.rules || !Array.isArray(data.rules)) {
      return false;
    }

    // map rules to actions
    actions = data.rules.map(mapToAction).filter((a) => !!a);
    if (actions.length === 0) {
      return false;
    }

    // update current selection
    selection = data.selection || '';

    // replace label with preview result
    for (const action of actions) {
      if (action.rule.preview) {
        const result = await execute(action.rule, selection);
        if (result) {
          action.label = result;
        } else {
          // disable preview if execution failed
          action.rule.preview = false;
        }
      }
    }

    // show native menu directly if no visible actions
    if (maxVisibleActions === 0) {
      if (isWindows) {
        menuMode = true;
        initialized = true;
        await resizeToolbar(data.mouse ?? false, true);
        return true;
      }

      await currentWindow.hide();
      await showNativeMenu(actions);
      return false;
    }

    // mark as initialized
    initialized = true;

    await resizeToolbar(data.mouse ?? false, true);

    return true;
  }

  /**
   * Resize the toolbar window to fit current content.
   *
   * @param mouse - whether to position near mouse cursor
   * @param reposition - whether to reposition the toolbar after resizing
   */
  async function resizeToolbar(mouse: boolean, reposition: boolean) {
    await tick();
    if (!container) {
      return;
    }

    try {
      // measure natural content size instead of the viewport-constrained layout size
      const dpr = window.devicePixelRatio;
      const scale = await currentWindow.scaleFactor();
      const width = ((container.scrollWidth + 10) * dpr) / scale;
      const height = ((container.scrollHeight + 10) * dpr) / scale;
      // set window size with some padding
      await currentWindow.setSize(new LogicalSize(width, height));
      if (reposition) {
        await invoke('position_toolbar', { mouse });
      } else if (menuMode) {
        await clampToolbarToSafeArea();
      }
    } catch (error) {
      console.error(`Failed to resize window: ${error}`);
    }
  }

  /**
   * Keep the resized HTML menu inside the current monitor safe area.
   */
  async function clampToolbarToSafeArea() {
    const monitor = await currentMonitor();
    if (!monitor) {
      return;
    }

    const scaleFactor = await currentWindow.scaleFactor();
    const windowPosition = (await currentWindow.outerPosition()).toLogical(scaleFactor);
    const windowSize = (await currentWindow.outerSize()).toLogical(scaleFactor);
    const screenPosition = monitor.position.toLogical(scaleFactor);
    const screenSize = monitor.size.toLogical(scaleFactor);
    const safeAreaBottom = SAFE_AREA_BOTTOM / scaleFactor;

    const minX = screenPosition.x;
    const maxX = Math.max(minX, screenPosition.x + screenSize.width - windowSize.width);
    const minY = screenPosition.y;
    const maxY = Math.max(minY, screenPosition.y + screenSize.height - windowSize.height - safeAreaBottom);
    const x = Math.min(maxX, Math.max(minX, windowPosition.x));
    const y = Math.min(maxY, Math.max(minY, windowPosition.y));

    await currentWindow.setPosition(new LogicalPosition(x, y));
  }

  /**
   * Show actions in a native menu.
   *
   * @param menuActions - actions to show in menu
   * @param position - optional menu position relative to toolbar window
   */
  async function showNativeMenu(menuActions: Action[], position?: LogicalPosition) {
    let menu: Menu | undefined;
    try {
      // create menu items with icons
      menu = await Menu.new({
        items: await Promise.all(
          menuActions.map(async (action) => {
            return await IconMenuItem.new({
              id: action.id,
              text: action.label,
              icon: await iconToImage(action.icon),
              action: () => executeAction(action)
            });
          })
        )
      });

      await invoke('set_toolbar_menu_open', { open: true });

      if (position) {
        // popup menu at the given position of toolbar window
        await menu.popup(position, currentWindow);
      } else {
        // popup menu at current mouse position
        await menu.popup();
      }
    } catch (error) {
      console.error(`Failed to show actions menu: ${error}`);
    } finally {
      try {
        await invoke('set_toolbar_menu_open', { open: false });
        await menu?.close();
      } catch (error) {
        console.error(`Failed to cleanup actions menu: ${error}`);
      }
    }
  }

  /**
   * Show more actions in overflow menu.
   */
  async function showMoreActions() {
    try {
      if (isWindows) {
        menuMode = true;
        await resizeToolbar(false, false);
        return;
      }

      // calculate bottom-right corner position
      const size = await currentWindow.innerSize();
      const scale = await currentWindow.scaleFactor();
      const width = size.width / scale;
      const height = size.height / scale;
      const bottomRightPosition = new LogicalPosition(width - 32, height - 2);

      // popup menu at bottom-right corner of toolbar window
      await showNativeMenu(overflowActions, bottomRightPosition);
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
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        svg.style.color = prefersDark ? '#ffffff' : '#000000';
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
   * Get current window placement information.
   */
  async function windowPlacement(): Promise<WindowPlacement> {
    const outerPosition = await currentWindow.outerPosition();
    const scaleFactor = await currentWindow.scaleFactor();
    const monitor = await currentMonitor();
    return {
      screenSize: monitor?.size.toLogical(scaleFactor),
      screenPosition: monitor?.position.toLogical(scaleFactor),
      windowPosition: outerPosition.toLogical(scaleFactor)
    };
  }

  /**
   * Handle action click event.
   *
   * @param action - toolbar action
   */
  async function executeAction(action: Action) {
    try {
      // get current window placement
      const placement = await windowPlacement();
      // hide the toolbar window
      await currentWindow.hide();

      if (action.rule.preview) {
        if (action.rule.outputMode === 'replace') {
          // replace selection with preview text
          await invoke('enter_text', {
            text: action.label,
            clipboard: action.rule.clipboard
          });
        } else if (action.rule.outputMode === 'popup') {
          // show popup with preview text
          await invoke('show_popup_sameplace', {
            payload: JSON.stringify({
              id: crypto.randomUUID(),
              result: action.label,
              copyOnPopup: action.rule.clipboard
            }),
            placement: placement
          });
        } else if (action.rule.outputMode === undefined && action.rule.clipboard) {
          // copy preview text to clipboard
          await invoke('set_clipboard_text', { text: action.label });
        }
      } else {
        // execute the action normally
        await execute(action.rule, selection, placement);
      }
    } catch (error) {
      console.error(`Failed to execute action: ${error}`);
    }
  }

  onMount(async () => {
    // mark toolbar as initialized
    await invoke('mark_toolbar_initialized');
  });

  onMount(() => {
    // listen to window show/hide events
    const unlistenWindowShow = listen<string>('show-toolbar', (event) => {
      initialized = false;
      setup(JSON.parse(event.payload)).then(async (showToolbar) => {
        if (!showToolbar) {
          await currentWindow.hide();
          return;
        }
        // show window without focusing
        const visible = await currentWindow.isVisible();
        if (!visible) {
          await invoke('show_toolbar_regardless');
        }
      });
    });
    const unlistenWindowHide = listen('hide-toolbar', () => {
      initialized = false;
      menuMode = false;
    });

    // listen to mouse enter/exit events
    const unlistenMouseEntered = listen('toolbar-entered', () => {
      mouseEntered = true;
    });
    const unlistenMouseExited = listen('toolbar-exited', () => {
      mouseEntered = false;
    });

    return () => {
      unlistenWindowShow.then((fn) => fn());
      unlistenWindowHide.then((fn) => fn());
      unlistenMouseExited.then((fn) => fn());
      unlistenMouseEntered.then((fn) => fn());
    };
  });
</script>

<main class="bg-transparent p-1 select-none">
  {#if initialized && menuMode && actions.length > 0}
    <div
      class="w-fit overflow-hidden border shadow-sm"
      style:border-radius={cornerRadiusStyle}
      in:fly={{ y: -6, duration: 100 }}
    >
      <div class="w-52 bg-base-200/95 py-1 backdrop-blur-sm" bind:this={container}>
        {#each actions as action (action.id)}
          <button
            class="flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left transition-colors"
            class:hover:bg-btn-hover={mouseEntered}
            class:hover:text-primary={mouseEntered}
            onclick={() => executeAction(action)}
            title={action.label}
          >
            {#if action.icon}
              <Icon icon={action.icon} class="size-4.5 shrink-0" />
            {:else}
              <span class="size-4.5 shrink-0"></span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-xs font-[450]">{action.label}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else if initialized && visibleActions.length > 0}
    <div
      class="w-fit overflow-hidden border shadow-sm"
      style:border-radius={cornerRadiusStyle}
      in:fly={{ y: -10, duration: 100 }}
    >
      <div class="flex h-8 w-max min-w-max" style:background-color={toolbarBackgroundStyle} bind:this={container}>
        <span
          class="flex shrink-0 cursor-grab active:cursor-grabbing items-center opacity-20 transition-opacity"
          class:hover:opacity-90={mouseEntered}
          style:background-image={actionBackgroundStyle}
          data-tauri-drag-region
        >
          <LineVerticalIcon class="pointer-events-none size-4" />
        </span>
        {#each visibleActions as action (action.id)}
          {@const showIcon = action.rule.displayMode !== 'label'}
          {@const showLabel = action.rule.displayMode !== 'icon'}
          <button
            class="flex shrink-0 cursor-pointer items-center gap-0.5 px-1.75 transition-colors"
            class:hover:bg-btn-hover={mouseEntered}
            class:hover:text-primary={mouseEntered}
            style:background-image={actionBackgroundStyle}
            onclick={() => executeAction(action)}
            title={action.label}
          >
            {#if showIcon && action.icon}
              <Icon icon={action.icon} class="size-4.5 shrink-0" />
            {/if}
            {#if showLabel}
              <span class="max-w-30 truncate text-xs font-[450]">{action.label}</span>
            {/if}
          </button>
        {/each}
        {#if overflowActions.length > 0}
          <button
            class="h-8 shrink-0 cursor-pointer opacity-30 transition-all"
            class:hover:bg-btn-hover={mouseEntered}
            class:hover:opacity-100={mouseEntered}
            style:background-image={actionBackgroundStyle}
            onclick={showMoreActions}
          >
            <DotsThreeVerticalIcon weight="bold" class="size-5" />
          </button>
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  :global {
    html,
    body {
      background: transparent;
    }
  }
</style>
