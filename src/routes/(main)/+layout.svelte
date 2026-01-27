<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Title } from '$lib/components';
  import { modals } from '$lib/components/Modal.svelte';
  import { Moon, Sun } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { theme } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ClockCounterClockwiseIcon, GearSixIcon, StackIcon } from 'phosphor-svelte';
  import { onMount, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // current window
  const currentWindow = getCurrentWindow();

  // scroll to top after navigation
  let main: HTMLElement;
  afterNavigate(() => {
    main.scrollTo(0, 0);
  });

  // whether to show the shadow under the title bar
  let titleShadow = $state(false);
  let sentinelElement: HTMLElement;

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        titleShadow = !entry.isIntersecting;
      },
      {
        // 40px is the height of the Title component
        rootMargin: '-40px 0px 0px 0px'
      }
    );
    observer.observe(sentinelElement);
    return () => {
      observer.disconnect();
    };
  });

  onMount(() => {
    let focused = false;
    let focusedTimeout: ReturnType<typeof setTimeout> | null = null;

    const oninvalid = (event: Event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        // prevent default validation bubble display
        event.preventDefault();

        // focus on the first invalid input
        if (!focused && document.activeElement !== event.target) {
          event.target.focus();
          focused = true;

          // reset the flag after a short delay
          // this allows a new validation cycle to start
          if (focusedTimeout) {
            clearTimeout(focusedTimeout);
          }
          focusedTimeout = setTimeout(() => (focused = false), 100);
        }
      }
    };
    // listen to all validation failure events
    document.addEventListener('invalid', oninvalid, true);
    return () => {
      // clean up event listeners
      document.removeEventListener('invalid', oninvalid, true);
      if (focusedTimeout) {
        clearTimeout(focusedTimeout);
      }
    };
  });

  onMount(() => {
    const unlisten = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // pause shortcut handling when window gains focus and there are open modals
        if (modals.size > 0) {
          invoke('pause_shortcut_handling');
        }
      } else {
        // resume shortcut handling when window loses focus
        invoke('resume_shortcut_handling');
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  onMount(() => {
    // listen to navigation events from backend
    const unlisten = listen<string>('goto', async (event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      goto(resolve(event.payload as any));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });
</script>

<main class="h-screen w-screen overflow-auto overscroll-none bg-base-300" bind:this={main}>
  <Title class="sticky top-0 z-101 bg-base-300/80 backdrop-blur-sm {titleShadow ? 'title-shadow' : ''}">
    {#snippet fallback()}
      <!-- shortcuts -->
      <div class="pointer-events-none flex items-center gap-1 rounded-field gradient bg-base-300 px-2 py-0.5">
        <StackIcon class="size-5 opacity-80" weight="duotone" />
        <span class="tracking-wider">{m.shortcuts()}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <!-- themes -->
        {#if theme.current !== 'system'}
          <label class="swap swap-rotate opacity-50 transition-opacity hover:opacity-100">
            <input
              type="checkbox"
              class="theme-controller"
              checked={theme.current === 'light'}
              onclick={(event) => {
                const checked = (event.target as HTMLInputElement).checked;
                theme.current = checked ? 'light' : 'dark';
              }}
            />
            <Moon class="swap-off size-5" />
            <Sun class="swap-on size-5" />
          </label>
        {/if}
        <!-- histories -->
        <button
          class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
          onclick={() => goto(resolve('/histories'))}
        >
          <ClockCounterClockwiseIcon class="size-5" />
        </button>
        <!-- settings -->
        <button
          class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
          onclick={() => goto(resolve('/settings'))}
        >
          <GearSixIcon class="size-5" />
        </button>
      </div>
    {/snippet}
  </Title>
  <div bind:this={sentinelElement}></div>
  <div class="p-2 pt-0.5">
    {@render children()}
  </div>
</main>
