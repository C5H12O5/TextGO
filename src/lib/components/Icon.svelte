<script lang="ts" module>
  import { phosphorIcons as phosphorIconLoaders } from '$lib/phosphor';
  import createDOMPurify from 'dompurify';
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  export { phosphorIcons } from '$lib/phosphor';

  export const ICON_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];
  export const MAX_ICON_BYTES = 128 * 1024;

  const SVG_MIME_TYPE = 'image/svg+xml';
  const purifier = typeof window !== 'undefined' ? createDOMPurify(window) : undefined;

  type CustomIcon = { src: string; useTextColor: boolean };

  /**
   * Encode image bytes as base64.
   *
   * @param bytes - image file bytes
   * @returns base64 encoded image data
   */
  function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  /**
   * Detect the MIME type of a raster image.
   *
   * @param bytes - image file bytes
   * @returns image MIME type, or undefined if unsupported
   */
  function rasterMimeType(bytes: Uint8Array): string | undefined {
    const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)) {
      return 'image/gif';
    }
    if (
      startsWith(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    if (startsWith(0x42, 0x4d)) return 'image/bmp';
    if (startsWith(0, 0, 1, 0)) return 'image/x-icon';
  }

  /**
   * Validate and sanitize SVG uploads and saved icons.
   *
   * @param source - SVG source text
   * @returns sanitized SVG data URL and text color flag, or undefined if invalid
   */
  function parseSVG(source: string): CustomIcon | undefined {
    if (!purifier || new TextEncoder().encode(source).length > MAX_ICON_BYTES) {
      return;
    }
    try {
      const document = new DOMParser().parseFromString(source, SVG_MIME_TYPE);
      if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
        return;
      }

      const svg = purifier.sanitize(document.documentElement.outerHTML, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['use'],
        FORBID_ATTR: ['xml:base'],
        ALLOW_DATA_ATTR: false,
        // preserve IDs because SVG images are isolated from the page
        SANITIZE_DOM: false,
        RETURN_DOM_FRAGMENT: true
      }).firstElementChild;
      if (svg?.localName !== 'svg') {
        return;
      }

      const content = new XMLSerializer().serializeToString(svg);
      const bytes = new TextEncoder().encode(content);
      if (bytes.length > MAX_ICON_BYTES) {
        return;
      }
      // use a mask when the SVG contains currentColor, otherwise use a background image
      return {
        src: `data:${SVG_MIME_TYPE};base64,${encodeBase64(bytes)}`,
        useTextColor: content.includes('currentColor')
      };
    } catch {
      return;
    }
  }

  /**
   * Create an image data URL while preserving animation and sanitizing SVG content.
   *
   * @param bytes - image file bytes
   * @returns base64 image data URL, or undefined if invalid
   */
  export function createCustomIconDataURL(bytes: Uint8Array): string | undefined {
    if (!bytes.length || bytes.length > MAX_ICON_BYTES) return;
    const mimeType = rasterMimeType(bytes);
    if (mimeType) return `data:${mimeType};base64,${encodeBase64(bytes)}`;
    try {
      return parseSVG(new TextDecoder('utf-8', { fatal: true }).decode(bytes))?.src;
    } catch {
      return;
    }
  }

  /**
   * Validate embedded icons from uploads and saved settings.
   *
   * @param value - base64 image data URL
   * @returns validated image data URL and text color flag, or undefined if invalid
   */
  export function parseCustomIcon(value: string): CustomIcon | undefined {
    const match = /^data:(image\/(?:svg\+xml|png|jpeg|gif|webp|bmp|x-icon));base64,/.exec(value);
    if (!match) return;
    const mimeType = match[1];
    const encoded = value.slice(match[0].length);
    if (
      !encoded.length ||
      encoded.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    ) {
      return;
    }
    try {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      if (bytes.length > MAX_ICON_BYTES) return;
      if (mimeType === SVG_MIME_TYPE) {
        return parseSVG(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      }
      if (rasterMimeType(bytes) === mimeType) return { src: value, useTextColor: false };
    } catch {
      return;
    }
  }

  export type IconProps = {
    /** Icon name or embedded image. */
    icon: Component<IconComponentProps> | string;
    /** Custom style class name. */
    class?: string;
  };
</script>

<script lang="ts">
  const { icon, class: _class }: IconProps = $props();

  const namedIcon = $derived.by(() => {
    if (typeof icon !== 'string' || icon.startsWith('data:')) {
      return;
    }
    return phosphorIconLoaders[icon]?.().then(({ default: Icon }) => Icon);
  });

  const customImage = $derived(typeof icon === 'string' ? parseCustomIcon(icon) : undefined);
</script>

{#if typeof icon !== 'string'}
  <!-- render phosphor icon component -->
  {@const Icon = icon}
  <Icon class={_class} />
{:else if icon.startsWith('data:')}
  <!-- render embedded image without flattening animated formats -->
  {#if customImage}
    <span
      class={_class}
      aria-hidden="true"
      data-image={customImage.src}
      data-use-text-color={customImage.useTextColor}
      style:--image={`url("${customImage.src}")`}
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
      background: var(--image) center / contain no-repeat;
    }

    span[data-use-text-color='true'] {
      background: currentColor;
      -webkit-mask: var(--image) center / contain no-repeat;
      mask: var(--image) center / contain no-repeat;
    }
  }
</style>
