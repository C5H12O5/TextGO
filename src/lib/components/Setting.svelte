<script lang="ts" module>
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';

  export type SettingProps = {
    /** Setting content snippet. */
    children: Snippet;
    /** Setting icon. */
    icon?: Component<IconComponentProps>;
    /** Setting title. */
    title: string;
    /** Tip text. */
    tip?: string;
    /** Custom style class name. */
    class?: string;
    iconClass?: string;
    /** Callback function when clicking more operations. */
    moreOptions?: () => void;
  };
</script>

<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { tooltip } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
  import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';

  let { children, icon, title, tip, class: _class, iconClass, moreOptions }: SettingProps = $props();
</script>

<div class="rounded-container {_class}">
  <div class="flex items-center gap-2">
    <span class="mr-auto flex min-h-7 items-center gap-2">
      {#if icon}
        {@const Icon = icon}
        <Icon class="size-5 opacity-80 {iconClass}" />
      {/if}
      <span class="font-semibold tracking-wider">
        {title}
      </span>
    </span>
    {#if tip}
      <span class="cursor-help" use:tooltip={{ content: tip, placement: 'left' }}>
        <QuestionIcon class="size-5 opacity-70" />
      </span>
    {/if}
    {#if moreOptions}
      <Button size="md" icon={SlidersHorizontalIcon} text={m.more_options()} onclick={() => moreOptions?.()} />
    {/if}
  </div>
  <div class="divider my-1"></div>
  <div class="flex flex-col gap-0.5 [&_fieldset]:px-1">
    {@render children()}
  </div>
</div>
