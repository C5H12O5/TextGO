<script lang="ts" module>
  import { getKbdLabel } from '$lib/helpers';
  import {
    ArrowBendDownLeft,
    ArrowDown,
    ArrowFatUp,
    ArrowLeft,
    ArrowLineRight,
    ArrowRight,
    ArrowUp,
    Backspace,
    Command,
    Control,
    MouseLeftClick,
    Option,
    WaveSine,
    WindowsLogo,
    type IconComponentProps
  } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  // mapping of key labels to icon components
  const ICON_MAP: Record<string, Component<IconComponentProps>> = {
    MouseClick: MouseLeftClick,
    MouseMove: WaveSine,
    Win: WindowsLogo,
    '⌘': Command,
    '⌃': Control,
    '⌥': Option,
    '⇧': ArrowFatUp,
    '↵': ArrowBendDownLeft,
    '⇥': ArrowLineRight,
    '↑': ArrowUp,
    '↓': ArrowDown,
    '←': ArrowLeft,
    '→': ArrowRight,
    '⌫': Backspace
  };

  /**
   * Get either the icon component or the label string for a given key code.
   *
   * @param code - key code
   * @returns icon component or label string
   */
  function getLabelOrIcon(code: string): Component<IconComponentProps> | string {
    const label = getKbdLabel(code);
    return ICON_MAP[label] ?? label;
  }
</script>

<script lang="ts">
  const { key, class: _class }: { key: string; class?: string } = $props();

  const kbd = $derived(getLabelOrIcon(key));
</script>

<kbd class="kbd min-w-8 font-sans {_class}">
  {#if typeof kbd === 'string'}
    <span class="text-sm font-light">{kbd}</span>
  {:else}
    {@const Icon = kbd}
    <Icon class="size-3.5" />
  {/if}
</kbd>
