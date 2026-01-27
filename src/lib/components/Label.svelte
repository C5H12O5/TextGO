<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';
  import type { Placement } from 'tippy.js';

  export type LabelProps = {
    /** Label text snippet. */
    children: Snippet;
    /** Label icon snippet. */
    icon?: Component<IconComponentProps>;
    /** Tip text. */
    tip?: string;
    /** Tip position. */
    tipPlacement?: Placement | 'duplex';
    /** Whether to mark as required. */
    required?: boolean;
    /** Custom style class name. */
    class?: string;
  };
</script>

<script lang="ts">
  import { tooltip } from '$lib/helpers';
  import { QuestionIcon } from 'phosphor-svelte';

  let { children, icon, tip, tipPlacement = 'left', required = false, class: _class }: LabelProps = $props();
</script>

<div class="flex items-center justify-between gap-2 p-1 {_class}">
  <span class="flex items-center gap-1">
    {#if required}
      <span class="h-6 text-lg text-error">*</span>
    {/if}
    {#if icon}
      {@const Icon = icon}
      <Icon class="mr-1 h-5" />
    {/if}
    <span class="flex flex-col gap-1">
      <div class="text-base tracking-wide opacity-90">{@render children()}</div>
      <!-- duplex tip -->
      {#if tip && tipPlacement == 'duplex'}
        <div class="pr-1 text-xs italic opacity-30">{tip}</div>
      {/if}
    </span>
  </span>
  <!-- hover tip -->
  {#if tip && tipPlacement != 'duplex'}
    <span class="cursor-help" use:tooltip={{ content: tip, placement: tipPlacement }}>
      <QuestionIcon class="size-5 opacity-70" />
    </span>
  {/if}
</div>
