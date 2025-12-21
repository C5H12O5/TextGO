<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';
  import type { MouseEventHandler } from 'svelte/elements';

  export type ButtonProps = Partial<{
    /** Button content snippet. */
    children: Snippet;
    /** Button icon. */
    icon: Component<IconComponentProps>;
    /** Button icon weight. */
    iconWeight: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
    /** Button text. */
    text: string;
    /** Button size. */
    size: keyof typeof PRESETS;
    /** Whether to use subtle button style. */
    subtle: boolean;
    /** Whether to make the button square. */
    square: boolean;
    /** Whether to add border to button. */
    border: boolean;
    /** Whether to add shadow to button. */
    shadow: boolean;
    /** Whether to show loading animation. */
    loading: boolean | null;
    /** Whether to disable button. */
    disabled: boolean;
    /** Custom style class name. */
    class: string;
    iconClass: string;
    textClass: string;
    /** Callback function when clicking the button. */
    onclick: MouseEventHandler<HTMLButtonElement>;
  }>;

  // preset sizes
  const PRESETS = {
    xs: {
      size: '1.5rem',
      iconSize: '1.125rem',
      textClass: 'text-xs'
    },
    sm: {
      size: '1.6rem',
      iconSize: '1.3rem',
      textClass: 'text-sm'
    },
    md: {
      size: '1.75rem',
      iconSize: '1.5rem',
      textClass: 'text-base'
    }
  };
</script>

<script lang="ts">
  import { tooltip } from '$lib/helpers';

  let {
    children,
    icon,
    iconWeight = 'regular',
    text,
    size = 'xs',
    subtle = true,
    square = true,
    border = false,
    shadow = false,
    loading = false,
    disabled = false,
    class: _class,
    iconClass,
    textClass,
    onclick
  }: ButtonProps = $props();

  const preset = $derived(PRESETS[size]);

  let subtleClass = $derived(subtle ? 'btn-subtle' : '');
  let squareClass = $derived(square ? 'p-0' : 'px-2');
  let borderClass = $derived(border ? 'border' : '');
  let shadowClass = $derived(shadow && !disabled ? 'shadow-sm' : '');
</script>

<button
  type="button"
  class="btn truncate opacity-80 {subtleClass} {squareClass} {borderClass} {shadowClass} {_class}"
  style:width={square ? preset.size : ''}
  style:height={preset.size}
  style:min-height={preset.size}
  {disabled}
  onclick={(event) => {
    !disabled && !loading && onclick?.(event);
  }}
  use:tooltip={{
    content: square ? text : '',
    followCursor: true
  }}
>
  {#if children}
    {@render children()}
  {:else}
    {#if loading}
      <span class="loading loading-spinner" style:width={preset.iconSize}></span>
    {:else}
      {@const Icon = icon}
      <Icon size={preset.iconSize} weight={iconWeight} class={iconClass} />
    {/if}
    <span class="truncate {square ? 'sr-only' : preset.textClass} {textClass}" title={text}>{text}</span>
  {/if}
</button>
