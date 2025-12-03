<script lang="ts">
  import { Kbd } from '$lib/components';

  const { shortcut, class: _class }: { shortcut: string; class?: string } = $props();

  // split shortcut into individual keys
  const keys = $derived(shortcut.split('+'));
</script>

<div class="flex items-center gap-0.5 text-primary/80 {_class}">
  {#each keys as key, index (index)}
    {@const modifier = index < keys.length - 1}
    {#if modifier}
      <Kbd {key} />
      <span class="text-sm opacity-30">+</span>
    {:else}
      <Kbd {key} />
    {/if}
  {/each}
</div>
