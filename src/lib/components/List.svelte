<script lang="ts" generics="T extends { id: string }">
  import { Button, confirm } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import {
    ArrowCircleDown,
    ArrowCircleUp,
    CaretDown,
    CaretRight,
    DotsThree,
    Lightbulb,
    PlusCircle,
    XCircle,
    type IconComponentProps
  } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';

  type ListProps = {
    /** List title. */
    title?: string | Snippet;
    /** List icon. */
    icon?: Component<IconComponentProps>;
    /** Hint message when the list is empty. */
    hint?: string;
    /** Data name. */
    name?: string;
    /** List data. */
    data: T[];
    /** Data row snippet. */
    row: Snippet<[T]>;
    /** Whether the list is collapsed. */
    collapsed?: boolean;
    /** Whether the list is collapsible. */
    collapsible?: boolean;
    /** Custom style class name. */
    class?: string;
    /** Callback function when clicking create. */
    oncreate?: () => void;
    /** Callback function after data deletion. */
    ondelete?: (item: T) => void;
    /** Callback function when clicking more operations. */
    moreOptions?: () => void;
  };

  let {
    title = '',
    icon,
    hint = '',
    name = '',
    data = $bindable(),
    row,
    collapsed = $bindable(),
    collapsible = false,
    class: _class,
    oncreate,
    ondelete,
    moreOptions
  }: ListProps = $props();

  // selected data ID
  let selectedId: string = $state('');
  // selected data number
  let selectedNum: string = $state('');
  // selected data element
  let selectedElement: HTMLLIElement | null = $state(null);

  /**
   * Scroll selected row into view.
   */
  function scrollIntoView() {
    if (!selectedElement) {
      return;
    }
    // execute after FLIP animation completes
    setTimeout(() => {
      selectedElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }, 200);
  }
</script>

<div class="overflow-hidden rounded-box border shadow-xs {_class}">
  <div
    class="flex items-center justify-between gradient px-2 py-1"
    style="border-bottom: 1px inset var(--color-border)"
  >
    <span class="flex items-center gap-1 text-base-content/80">
      <!-- collapse/expand button -->
      {#if collapsible}
        <Button class="swap swap-rotate {collapsed ? '' : 'swap-active'}" onclick={() => (collapsed = !collapsed)}>
          <CaretDown class="swap-on size-4.5" />
          <CaretRight class="swap-off size-4.5" />
        </Button>
      {/if}
      <!-- icon and title -->
      {#if icon}
        {@const Icon = icon}
        <Icon class="mx-1 size-4 opacity-60" />
      {/if}
      {#if typeof title === 'string'}
        <span class="text-sm tracking-wide opacity-60">{title}</span>
      {:else}
        {@render title()}
      {/if}
    </span>
    <!-- action buttons -->
    <span class="flex items-center gap-1">
      <Button
        icon={PlusCircle}
        iconWeight="bold"
        text="{m.add()}{name}"
        class="text-green-800"
        onclick={() => oncreate?.()}
      />
      <Button
        icon={XCircle}
        iconWeight="bold"
        text="{m.delete()}{name}"
        class={selectedId ? 'text-red-800' : 'btn-disabled'}
        onclick={() => {
          if (!selectedId) {
            return;
          }
          // confirm delete operation
          confirm({
            title: `${m.delete()}${name}[${selectedNum}]`,
            message: m.delete_confirm_message(),
            onconfirm: () => {
              const index = data.findIndex((i) => i.id === selectedId);
              if (index !== -1) {
                const item = data[index];
                data.splice(index, 1);
                ondelete?.(item);
              }
              selectedId = '';
              selectedNum = '';
              selectedElement = null;
            }
          });
        }}
      />
      <Button
        icon={ArrowCircleUp}
        iconWeight="bold"
        text={m.move_up()}
        class={selectedId ? 'text-surface' : 'btn-disabled'}
        onclick={() => {
          if (!selectedId) {
            return;
          }
          const index = data.findIndex((i) => i.id === selectedId);
          if (index > 0) {
            const temp = data[index];
            data[index] = data[index - 1];
            data[index - 1] = temp;
          }
          scrollIntoView();
        }}
      />
      <Button
        icon={ArrowCircleDown}
        iconWeight="bold"
        text={m.move_down()}
        class={selectedId ? 'text-surface' : 'btn-disabled'}
        onclick={() => {
          if (!selectedId) {
            return;
          }
          const index = data.findIndex((i) => i.id === selectedId);
          if (index < data.length - 1) {
            const temp = data[index];
            data[index] = data[index + 1];
            data[index + 1] = temp;
          }
          scrollIntoView();
        }}
      />
      {#if moreOptions}
        <Button icon={DotsThree} iconWeight="bold" text={m.more_options()} onclick={() => moreOptions?.()} />
      {/if}
    </span>
  </div>
  <!-- data list -->
  {#if !collapsed}
    <ul
      class="list overflow-y-auto bg-base-100 scrollbar-none [&_.list-row]:min-h-10 [&_.list-row]:py-1"
      transition:slide={{ duration: 300 }}
    >
      {#if data.length === 0 && hint}
        <li class="list-row mx-auto items-center gap-1 text-surface/35">
          <Lightbulb class="size-3.5" />{hint}
        </li>
      {/if}
      {#each data as item, index (item.id)}
        {@const itemNum = (index + 1).toString().padStart(2, '0')}
        {@const evenIdx = index % 2 === 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="list-row cursor-pointer items-center rounded-none hover:bg-base-300 {evenIdx ? '' : 'bg-base-150'}"
          onclick={(event) => {
            if (selectedId === item.id) {
              selectedId = '';
              selectedNum = '';
              selectedElement = null;
            } else {
              selectedId = item.id;
              selectedNum = itemNum;
              selectedElement = event.currentTarget as HTMLLIElement;
            }
          }}
          animate:flip={{ duration: 200 }}
        >
          <span class="flex items-center gap-1">
            <input type="radio" class="pointer-events-none radio radio-xs" checked={selectedId === item.id} />
            <span class="text-base font-thin {selectedId === item.id ? '' : 'opacity-60'}">{itemNum}</span>
          </span>
          {@render row(item)}
        </li>
      {/each}
    </ul>
  {/if}
</div>
