<script lang="ts" module>
  import { getKbdLabel } from '$lib/helpers';
  import ArrowBendDownLeftIcon from 'phosphor-svelte/lib/ArrowBendDownLeftIcon';
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import ArrowFatUpIcon from 'phosphor-svelte/lib/ArrowFatUpIcon';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
  import ArrowLineRightIcon from 'phosphor-svelte/lib/ArrowLineRightIcon';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
  import BackspaceIcon from 'phosphor-svelte/lib/BackspaceIcon';
  import CommandIcon from 'phosphor-svelte/lib/CommandIcon';
  import ControlIcon from 'phosphor-svelte/lib/ControlIcon';
  import MouseLeftClickIcon from 'phosphor-svelte/lib/MouseLeftClickIcon';
  import OptionIcon from 'phosphor-svelte/lib/OptionIcon';
  import WaveSineIcon from 'phosphor-svelte/lib/WaveSineIcon';
  import WindowsLogoIcon from 'phosphor-svelte/lib/WindowsLogoIcon';
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  // mapping of key labels to icon components
  const ICON_MAP: Record<string, Component<IconComponentProps>> = {
    MouseClick: MouseLeftClickIcon,
    MouseMove: WaveSineIcon,
    Win: WindowsLogoIcon,
    '⌘': CommandIcon,
    '⌃': ControlIcon,
    '⌥': OptionIcon,
    '⇧': ArrowFatUpIcon,
    '↵': ArrowBendDownLeftIcon,
    '⇥': ArrowLineRightIcon,
    '↑': ArrowUpIcon,
    '↓': ArrowDownIcon,
    '←': ArrowLeftIcon,
    '→': ArrowRightIcon,
    '⌫': BackspaceIcon
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
  const {
    key,
    small = false,
    class: _class
  }: {
    key: string;
    small?: boolean;
    class?: string;
  } = $props();

  const kbd = $derived(getLabelOrIcon(key));
</script>

<kbd class="kbd text-inherit min-w-8 font-sans {small ? 'kbd-sm' : ''} {_class}">
  {#if typeof kbd === 'string'}
    <span class="font-light {small ? 'text-sm' : 'text-base'}">{kbd}</span>
  {:else}
    {@const Icon = kbd}
    <Icon class={small ? 'size-3.5' : 'size-4'} />
  {/if}
</kbd>
