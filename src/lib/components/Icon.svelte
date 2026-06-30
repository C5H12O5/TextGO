<script lang="ts" module>
  import { phosphorIcons as phosphorIconLoaders } from '$lib/phosphor';
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  export { phosphorIcons } from '$lib/phosphor';

  export type IconProps = {
    /** Icon name or base64-encoded SVG data URL. */
    icon: Component<IconComponentProps> | string;
    /** Custom style class name. */
    class?: string;
  };

  /**
   * Decode base64 SVG data URL to SVG HTML string.
   *
   * @param base64 - base64 SVG data URL
   * @param className - optional style class name
   */
  function decodeBase64SVG(base64: string, className?: string): string {
    const data = base64.replace('data:image/svg+xml;base64,', '');
    const svg = atob(data);
    if (!className) {
      return svg;
    }
    // inject class attribute into the SVG tag
    return svg.replace(/<svg([^>]*)>/, (match, attrs) => {
      // check if class attribute already exists
      if (attrs.includes('class=')) {
        return match.replace(/class="([^"]*)"/, `class="$1 ${className}"`);
      }
      return `<svg${attrs} class="${className}">`;
    });
  }
</script>

<script lang="ts">
  const { icon, class: _class }: IconProps = $props();

  const namedIcon = $derived.by(() => {
    if (typeof icon !== 'string' || icon.startsWith('data:image/svg+xml;base64,')) {
      return;
    }
    return phosphorIconLoaders[icon]?.().then(({ default: Icon }) => Icon);
  });
</script>

{#if typeof icon !== 'string'}
  <!-- render phosphor icon component -->
  {@const Icon = icon}
  <Icon class={_class} />
{:else if icon.startsWith('data:image/svg+xml;base64,')}
  <!-- render base64 SVG -->
  {@const svg = decodeBase64SVG(icon, _class)}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html svg}
{:else}
  <!-- render phosphor icon name -->
  {#if namedIcon}
    {#await namedIcon then Icon}
      <Icon class={_class} />
    {/await}
  {/if}
{/if}
