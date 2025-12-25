<script lang="ts" generics="T">
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  type RadioProps = {
    /** Radio group. */
    group: T;
    /** Radio value. */
    value: T;
    /** Radio name. */
    name?: string;
    /** Radio icon. */
    icon?: Component<IconComponentProps>;
    /** Radio label. */
    label?: string;
    /** Whether to disable radio. */
    disabled?: boolean;
    /** Custom style class name. */
    class?: string;
    iconClass?: string;
    labelClass?: string;
    radioClass?: string;
  };

  let {
    group = $bindable(),
    value,
    name,
    icon,
    label,
    disabled = false,
    class: _class,
    iconClass,
    labelClass,
    radioClass
  }: RadioProps = $props();

  let checkedClass = $derived(group === value ? 'gradient bg-base-200 text-base-content shadow-sm' : 'outline-dashed');
  let disabledClass = $derived(disabled ? 'opacity-50 cursor-not-allowed' : '');
</script>

<label class="label rounded-box px-2 py-1 outline transition-all {checkedClass} {disabledClass} {_class}">
  <input
    type="radio"
    bind:group
    {name}
    {value}
    {disabled}
    class="radio checked:border-emphasis checked:text-emphasis disabled:opacity-100 {radioClass}"
  />
  {#if icon}
    {@const Icon = icon}
    <Icon class={iconClass} />
  {/if}
  {#if label}
    <span class={labelClass}>{label}</span>
  {/if}
</label>
