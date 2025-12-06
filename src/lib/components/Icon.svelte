<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import * as phosphor from 'phosphor-svelte';
  import type { Component } from 'svelte';

  // mapping of phosphor icons
  export const phosphorIcons = Object.fromEntries(
    Object.entries(phosphor).filter(([name]) => name !== 'IconContext')
  ) as Record<string, Component<IconComponentProps>>;
</script>

<script lang="ts">
  const { icon, class: _class }: { icon: string; class?: string } = $props();
</script>

{#if icon.startsWith('data:image/svg+xml;base64,')}
  <!-- render base64 SVG -->
  <img src={icon} alt="icon" class={_class} />
{:else}
  <!-- render phosphor icon -->
  {@const Icon = phosphorIcons[icon]}
  {#if Icon}
    <Icon class={_class} />
  {/if}
{/if}
