<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import * as phosphor from 'phosphor-svelte';
  import type { Component } from 'svelte';

  export type IconProps = {
    /** Icon name or base64-encoded SVG data URL. */
    icon: Component<IconComponentProps> | string;
    /** Custom style class name. */
    class?: string;
  };

  // mapping of phosphor icons
  export const phosphorIcons = Object.fromEntries(
    Object.entries(phosphor).filter(([name]) => name !== 'IconContext')
  ) as Record<string, Component<IconComponentProps>>;
</script>

<script lang="ts">
  const { icon, class: _class }: IconProps = $props();
</script>

{#if typeof icon !== 'string'}
  <!-- render phosphor icon component -->
  {@const Icon = icon}
  <Icon class={_class} />
{:else if icon.startsWith('data:image/svg+xml;base64,')}
  <!-- render base64 SVG -->
  <img src={icon} alt="icon" class={_class} />
{:else}
  <!-- render phosphor icon name -->
  {@const Icon = phosphorIcons[icon]}
  {#if Icon}
    <Icon class={_class} />
  {/if}
{/if}
