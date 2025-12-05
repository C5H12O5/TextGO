<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type TitleProps = {
    /** Window title snippet. */
    children?: Snippet;
    /** Default title snippet. */
    fallback?: Snippet;
    /** Custom style class name. */
    class?: string;
  };

  // current title snippet
  let title: Snippet | null = $state(null);
</script>

<script lang="ts">
  import { type } from '@tauri-apps/plugin-os';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';

  let { children, fallback, class: _class }: TitleProps = $props();

  // operating system type
  const osType = type();

  onMount(() => {
    if (children) {
      title = children;
      return () => {
        title = null;
      };
    }
  });
</script>

{#if !children}
  <div
    class="pr-4 select-none {osType === 'macos' ? 'pl-22 [&_.mx-auto]:pr-18' : 'pl-2'} {_class}"
    data-tauri-drag-region
  >
    {#if title}
      <div class="flex h-10 items-center" in:fly={{ x: 15, duration: 150 }} data-tauri-drag-region>
        {@render title()}
      </div>
    {:else if fallback}
      <div class="flex h-10 items-center" in:fly={{ x: -15, duration: 150 }} data-tauri-drag-region>
        {@render fallback()}
      </div>
    {/if}
  </div>
{/if}
