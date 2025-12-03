<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Title } from '$lib/components';
  import { Moon, Sun } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { theme } from '$lib/stores.svelte';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ClockCounterClockwise, GearSix, Stack } from 'phosphor-svelte';
  import { onMount, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // whether to show title bar bottom border
  let titleBorder = $state(false);
  let sentinelElement: HTMLElement;

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        // show title bar bottom border when sentinel element is invisible
        titleBorder = !entry.isIntersecting;
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
    const oninvalid = (event: Event) => {
      if (event.target instanceof HTMLInputElement) {
        // prevent default validation bubble display
        event.preventDefault();
        // focus on the input box that failed validation
        if (document.activeElement !== event.target) {
          event.target.focus();
        }
      }
    };
    // listen to all validation failure events
    document.addEventListener('invalid', oninvalid, true);
    return () => {
      // clean up event listeners
      document.removeEventListener('invalid', oninvalid, true);
    };
  });

  onMount(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // in some cases, after hiding and showing the window,
        // an element in the page may unexpectedly get focus,
        // which is canceled here
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && activeElement !== document.body) {
          activeElement.blur();
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  onMount(() => {
    // listen to navigation events from backend
    const unlisten = listen('goto-shortcuts', async () => {
      goto(resolve('/shortcuts'));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });
</script>

<main class="h-screen w-screen overflow-auto overscroll-none bg-base-300">
  <Title class="sticky top-0 z-101 bg-base-300/80 backdrop-blur-sm {titleBorder ? 'border-b' : ''}">
    {#snippet fallback()}
      <!-- shortcuts -->
      <div class="pointer-events-none flex items-center gap-1 rounded-field gradient bg-base-300 px-2 py-0.5">
        <Stack class="size-5 opacity-80" weight="duotone" />
        <span class="tracking-wider">{m.shortcuts()}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <!-- themes -->
        <label class="swap swap-rotate opacity-50 transition-opacity hover:opacity-100">
          <input
            type="checkbox"
            class="theme-controller"
            checked={theme.current === 'light'}
            onclick={(event) => {
              const isLight = (event.target as HTMLInputElement).checked;
              theme.current = isLight ? 'light' : 'dracula';
            }}
          />
          <Moon class="swap-off size-5" />
          <Sun class="swap-on size-5" />
        </label>
        <!-- histories -->
        <button
          class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
          onclick={() => goto(resolve('/histories'))}
        >
          <ClockCounterClockwise class="size-5" />
        </button>
        <!-- settings -->
        <button
          class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
          onclick={() => goto(resolve('/settings'))}
        >
          <GearSix class="size-5" />
        </button>
      </div>
    {/snippet}
  </Title>
  <div bind:this={sentinelElement}></div>
  <div class="p-2 pt-0.5">
    {@render children()}
  </div>
</main>
