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
  const LOCAL_FRAGMENT = /^#[A-Za-z_][\w:.-]*$/;
  const LOCAL_URL = /^url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)$/i;
  const REFERENCE_ATTRIBUTES = ['href', 'xlink:href', 'src'];
  const PRESENTATION_ATTRIBUTES = [
    'color',
    'fill',
    'fill-opacity',
    'fill-rule',
    'opacity',
    'stop-color',
    'stop-opacity',
    'stroke',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width'
  ];
  const SIMPLE_CLASS_SELECTOR = /^\.[A-Za-z_][\w-]*$/;
  const UNSAFE_STYLE_VALUE = /\\|(?:javascript|data):|expression\s*\(|@/i;
  const FORBIDDEN_TAGS = [
    'script',
    'style',
    'foreignobject',
    'image',
    'feimage',
    'a',
    'iframe',
    'object',
    'embed',
    'audio',
    'video',
    'animate',
    'animatemotion',
    'animatetransform',
    'set',
    'discard'
  ];

  export type IconProps = {
    /** Icon name or base64-encoded SVG data URL. */
    icon: Component<IconComponentProps> | string;
    /** Custom style class name. */
    class?: string;
  };

  /**
   * Decode a base64 SVG data URL as UTF-8 within the configured size limit.
   *
   * @param dataURL - base64 SVG data URL
   * @returns decoded SVG content, or undefined when invalid
   */
  function decodeSVGDataURL(dataURL: string): string | undefined {
    if (!dataURL.startsWith(SVG_DATA_URL_PREFIX)) {
      return;
    }

    const encoded = dataURL.slice(SVG_DATA_URL_PREFIX.length);
    if (
      encoded.length === 0 ||
      encoded.length > MAX_BASE64_LENGTH ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ) {
      return;
    }

    try {
      const binary = atob(encoded);
      if (binary.length > MAX_SVG_BYTES) {
        return;
      }
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return;
    }
  }

  /**
   * Check whether an SVG reference is restricted to the current document.
   *
   * @param name - attribute name
   * @param value - attribute value
   * @returns whether the attribute contains a disallowed reference
   */
  function hasExternalReference(name: string, value: string): boolean {
    const normalizedName = name.toLowerCase();
    const normalizedValue = value.trim();
    if (REFERENCE_ATTRIBUTES.includes(normalizedName)) {
      return !LOCAL_FRAGMENT.test(normalizedValue);
    }
    return /url\s*\(/i.test(normalizedValue) && !LOCAL_URL.test(normalizedValue);
  }

  /**
   * Apply safe SVG presentation attributes from a CSS declaration block.
   *
   * @param element - target SVG element
   * @param style - CSS declaration block
   */
  function applyPresentationStyle(element: Element, style: string) {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.setAttribute('style', style);

    for (const name of PRESENTATION_ATTRIBUTES) {
      const value = probe.style.getPropertyValue(name).trim();
      if (value && !UNSAFE_STYLE_VALUE.test(value) && !hasExternalReference(name, value)) {
        element.setAttribute(name, value);
      }
    }
  }

  /**
   * Convert simple stylesheet and inline declarations to presentation attributes.
   * The original CSS is removed before DOMPurify processes the SVG.
   *
   * @param source - parsed SVG document
   */
  function normalizeSVGStyles(source: Document) {
    for (const styleElement of source.querySelectorAll('style')) {
      for (const rule of (styleElement.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = rule[1].split(',').map((selector) => selector.trim());
        if (!selectors.every((selector) => SIMPLE_CLASS_SELECTOR.test(selector))) {
          continue;
        }

        for (const selector of selectors) {
          for (const element of source.querySelectorAll(selector)) {
            applyPresentationStyle(element, rule[2]);
          }
        }
      }
      styleElement.remove();
    }

    for (const element of source.querySelectorAll('[style]')) {
      applyPresentationStyle(element, element.getAttribute('style') ?? '');
      element.removeAttribute('style');
    }
  }

  /**
   * Sanitize a base64 SVG data URL for safe inline rendering.
   *
   * @param dataURL - base64 SVG data URL
   * @param className - optional classes to apply to the root SVG element
   * @returns sanitized SVG markup, or undefined when invalid
   */
  function sanitizeSVGDataURL(dataURL: string, className?: string): string | undefined {
    const svg = decodeSVGDataURL(dataURL);
    if (!svg) {
      return;
    }

    const parser = new DOMParser();
    const source = parser.parseFromString(svg, 'image/svg+xml');
    if (source.querySelector('parsererror') || source.documentElement.localName !== 'svg') {
      return;
    }
    normalizeSVGStyles(source);

    const purifier = createDOMPurify(window);
    purifier.addHook('uponSanitizeAttribute', (_element, attribute) => {
      const name = attribute.attrName.toLowerCase();
      if (REFERENCE_ATTRIBUTES.includes(name) && LOCAL_FRAGMENT.test(attribute.attrValue.trim())) {
        attribute.forceKeepAttr = true;
      } else if (name.startsWith('on') || hasExternalReference(name, attribute.attrValue)) {
        attribute.keepAttr = false;
      }
    });

    const sanitized = purifier.sanitize(new XMLSerializer().serializeToString(source.documentElement), {
      USE_PROFILES: { svg: true },
      ADD_TAGS: ['use'],
      ADD_ATTR: ['href', 'xlink:href'],
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: ['style', 'xml:base'],
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      SAFE_FOR_XML: true,
      SANITIZE_DOM: true
    });
    const result = parser.parseFromString(sanitized, 'image/svg+xml');
    if (result.querySelector('parsererror') || result.documentElement.localName !== 'svg') {
      return;
    }

    if (className) {
      result.documentElement.classList.add(...className.split(/\s+/).filter(Boolean));
    }
    return new XMLSerializer().serializeToString(result.documentElement);
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

  const customSVG = $derived.by(() => {
    if (!browser || typeof icon !== 'string' || !icon.startsWith('data:image/svg+xml;base64,')) {
      return;
    }
    return sanitizeSVGDataURL(icon, _class);
  });
</script>

{#if typeof icon !== 'string'}
  <!-- render phosphor icon component -->
  {@const Icon = icon}
  <Icon class={_class} />
{:else if icon.startsWith('data:image/svg+xml;base64,')}
  <!-- render base64 SVG -->
  {#if customSVG}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html customSVG}
  {/if}
{:else}
  <!-- render phosphor icon name -->
  {#if namedIcon}
    {#await namedIcon then Icon}
      <Icon class={_class} />
    {/await}
  {/if}
{/if}
