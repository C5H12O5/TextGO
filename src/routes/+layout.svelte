<script lang="ts">
  import { dev } from '$app/environment';
  import Alert from '$lib/components/Alert.svelte';
  import Confirm from '$lib/components/Confirm.svelte';
  import { customThemes, theme } from '$lib/stores.svelte';
  import { buildRuntimeStyles, isSystemTheme, resolveTheme } from '$lib/theme';
  import { platform } from '@tauri-apps/plugin-os';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  // import fonts
  import '@fontsource-variable/noto-sans';
  import '@fontsource-variable/noto-sans-sc';
  // import styles
  import 'tippy.js/animations/scale.css';
  import 'tippy.js/dist/tippy.css';
  import '../app.css';

  let { children }: { children: Snippet } = $props();

  // runtime custom theme style element
  let customThemeStyle: HTMLStyleElement | null = $state(null);

  // apply custom theme styles to the current window
  $effect(() => {
    if (!customThemeStyle) {
      return;
    }
    try {
      customThemeStyle.textContent = buildRuntimeStyles(customThemes.current);
    } catch {
      customThemeStyle.textContent = '';
    }
  });

  // auto switch theme when system theme changes
  const prefersDark = new MediaQuery('(prefers-color-scheme: dark)');
  $effect(() => {
    if (isSystemTheme(theme.current)) {
      const root = document.documentElement;
      root.setAttribute('data-theme', resolveTheme(theme.current, prefersDark.current));
    }
  });

  // disable right-click menu
  if (!dev) {
    onMount(() => {
      const disableContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        return false;
      };
      document.addEventListener('contextmenu', disableContextMenu);
      return () => {
        document.removeEventListener('contextmenu', disableContextMenu);
      };
    });
  }

  // set platform data attribute
  onMount(() => {
    const platformName = platform();
    document.documentElement.setAttribute('data-tauri-platform', platformName);
  });

  // create a style element for runtime custom themes
  onMount(() => {
    customThemeStyle = document.createElement('style');
    document.head.appendChild(customThemeStyle);
    return () => customThemeStyle?.remove();
  });
</script>

<svelte:window
  onkeydown={(event) => {
    // prevent backspace from navigating back
    if (event.key === 'Backspace') {
      // check if the target is not an input or textarea
      const target = event.target as HTMLElement;
      if (target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA' && !target?.isContentEditable) {
        event.preventDefault();
      }
    }
  }}
/>

{@render children()}

<!-- global alert component -->
<Alert />

<!-- global confirm component -->
<Confirm />
