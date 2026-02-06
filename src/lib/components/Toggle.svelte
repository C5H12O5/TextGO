<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  import type { ChangeEventHandler } from 'svelte/elements';

  export type ToggleProps = {
    /** Toggle value. */
    value: boolean;
    /** Toggle icon. */
    icon?: Component<IconComponentProps>;
    /** Toggle label. */
    label?: string;
    /** Whether to disable toggle. */
    disabled?: boolean;
    /** Custom style class name. */
    class?: string;
    iconClass?: string;
    labelClass?: string;
    toggleClass?: string;
    /** Callback function when toggle value changes. */
    onchange?: ChangeEventHandler<HTMLInputElement>;
  };
</script>

<script lang="ts">
  let {
    value = $bindable(false),
    icon,
    label,
    disabled = false,
    class: _class,
    iconClass,
    labelClass,
    toggleClass,
    onchange
  }: ToggleProps = $props();

  let checkedClass = $derived(value ? 'text-base-content' : '');
  let disabledClass = $derived(disabled ? 'opacity-50 cursor-not-allowed' : '');
</script>

<label class="label w-fit {checkedClass} {disabledClass} {_class}">
  <input
    type="checkbox"
    bind:checked={value}
    {disabled}
    {onchange}
    class="toggle checked:border-emphasis checked:bg-emphasis checked:text-white {toggleClass}"
  />
  {#if icon}
    {@const Icon = icon}
    <Icon class={iconClass} />
  {/if}
  {#if label}
    <span class={labelClass}>{label}</span>
  {/if}
</label>
