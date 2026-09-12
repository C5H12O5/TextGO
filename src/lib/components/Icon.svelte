<script lang="ts" module>
  import { browser } from '$app/environment';
  import { phosphorIcons as phosphorIconLoaders } from '$lib/phosphor';
  import createDOMPurify from 'dompurify';
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  export { phosphorIcons } from '$lib/phosphor';

  const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;base64,';
  const MAX_SVG_BYTES = 128 * 1024;
  const MAX_BASE64_LENGTH = Math.ceil(MAX_SVG_BYTES / 3) * 4;
  const purifier = browser ? createDOMPurify(window) : undefined;

  /**
   * Validate and sanitize SVG uploads and saved icons.
   *
   * @param source - SVG source text
   * @returns sanitized SVG data URL and text color flag, or undefined if invalid
   */
  function parseSVG(source: string): { src: string; useTextColor: boolean } | undefined {
    if (!purifier || new TextEncoder().encode(source).length > MAX_SVG_BYTES) return;
    try {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml');
      if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') return;

      const svg = purifier.sanitize(document.documentElement.outerHTML, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['use'],
        FORBID_ATTR: ['xml:base'],
        ALLOW_DATA_ATTR: false,
        // preserve IDs because SVG images are isolated from the page
        SANITIZE_DOM: false,
        RETURN_DOM_FRAGMENT: true
      }).firstElementChild;
      if (svg?.localName !== 'svg') return;

      const content = new XMLSerializer().serializeToString(svg);
      const bytes = new TextEncoder().encode(content);
      if (bytes.length > MAX_SVG_BYTES) return;
      // use a mask when the SVG contains currentColor, otherwise use a background image
      return {
        src: SVG_DATA_URL_PREFIX + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
        useTextColor: content.includes('currentColor')
      };
    } catch {
      return;
    }
  }

  /**
   * Create a sanitized SVG data URL.
   *
   * @param source - SVG source text
   * @returns base64 SVG data URL, or undefined if invalid
   */
  export function createSVGDataURL(source: string): string | undefined {
    return parseSVG(source)?.src;
  }

  export type IconProps = {
    /** Icon name or SVG image. */
    icon: Component<IconComponentProps> | string;
    /** Custom style class name. */
    class?: string;
  };
</script>

<script lang="ts">
  const { icon, class: _class }: IconProps = $props();

  const namedIcon = $derived.by(() => {
    if (typeof icon !== 'string' || icon.startsWith(SVG_DATA_URL_PREFIX)) {
      return;
    }
    return phosphorIconLoaders[icon]?.().then(({ default: Icon }) => Icon);
  });

  const customSVG = $derived.by(() => {
    if (!browser || typeof icon !== 'string' || !icon.startsWith(SVG_DATA_URL_PREFIX)) {
      return;
    }
    const encoded = icon.slice(SVG_DATA_URL_PREFIX.length);
    if (encoded.length > MAX_BASE64_LENGTH) return;
    try {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      return parseSVG(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return;
    }
  });
</script>

{#if typeof icon !== 'string'}
  <!-- render phosphor icon component -->
  {@const Icon = icon}
  <Icon class={_class} />
{:else if icon.startsWith(SVG_DATA_URL_PREFIX)}
  <!-- render base64 SVG -->
  {#if customSVG}
    <span
      class={_class}
      aria-hidden="true"
      data-svg={customSVG.src}
      data-use-text-color={customSVG.useTextColor}
      style:--svg={`url("${customSVG.src}")`}
    ></span>
  {/if}
{:else}
  <!-- render phosphor icon name -->
  {#if namedIcon}
    {#await namedIcon then Icon}
      <Icon class={_class} />
    {/await}
  {/if}
{/if}

<style>
  @layer base {
    span {
      display: inline-block;
      width: 1em;
      height: 1em;
      background: var(--svg) center / contain no-repeat;
    }

    span[data-use-text-color='true'] {
      background: currentColor;
      -webkit-mask: var(--svg) center / contain no-repeat;
      mask: var(--svg) center / contain no-repeat;
    }
  }
</style>
