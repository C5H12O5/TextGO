<script lang="ts" generics="T extends { id: string }">
  import Button from '$lib/components/Button.svelte';
  import { confirm } from '$lib/components/Confirm.svelte';
  import { m } from '$lib/paraglide/messages';
  import type { IconComponentProps } from 'phosphor-svelte';
  import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
  import ArrowCircleUpIcon from 'phosphor-svelte/lib/ArrowCircleUpIcon';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
  import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
  import LightbulbIcon from 'phosphor-svelte/lib/LightbulbIcon';
  import PlusCircleIcon from 'phosphor-svelte/lib/PlusCircleIcon';
  import ShareIcon from 'phosphor-svelte/lib/ShareIcon';
  import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
  import { onDestroy, type Component, type Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import { SvelteSet } from 'svelte/reactivity';
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
    /** Callback function after each item is deleted, including batch deletion. */
    ondelete?: (item: T) => void;
    /** Callback function for importing data. */
    onimport?: () => void;
    /** Callback function for exporting all selected items in list order. */
    onexport?: (items: T[]) => void | Promise<void>;
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
    onimport,
    onexport
  }: ListProps = $props();

  // selected data IDs
  const selectedIds = new SvelteSet<string>();
  // selected data items in list order
  const selectedItems = $derived(data.filter((item) => selectedIds.has(item.id)));
  // number of selected data items
  const selectedCount = $derived(selectedItems.length);
  // action labels for single and multiple selections
  const deleteText = $derived(selectedCount > 1 ? m.delete_count({ count: selectedCount }) : `${m.delete()}${name}`);
  const exportText = $derived(selectedCount > 1 ? m.export_count({ count: selectedCount }) : `${m.export()}${name}`);
  // export operation state
  let exporting = $state(false);
  // data list element
  let listElement: HTMLUListElement | undefined = $state();
  // pending scroll timer
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  // remove selections when the underlying data is deleted or renamed
  $effect(() => {
    const ids = new Set(data.map((item) => item.id));
    for (const id of selectedIds) {
      if (!ids.has(id)) {
        selectedIds.delete(id);
      }
    }
  });

  // cancel pending scrolling when the component is destroyed
  onDestroy(() => clearTimeout(scrollTimer));

  /**
   * Toggle selection of a data item.
   *
   * @param id - data item ID
   */
  function toggleSelection(id: string) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
  }

  /**
   * Confirm and delete selected data items.
   */
  function deleteSelected() {
    if (!selectedCount) {
      return;
    }
    // preserve the selected IDs while the confirmation dialog is open
    const ids = new Set(selectedItems.map((item) => item.id));
    const itemNum = (data.findIndex((item) => ids.has(item.id)) + 1).toString().padStart(2, '0');
    confirm({
      title: selectedCount > 1 ? deleteText : `${m.delete()}${name}[${itemNum}]`,
      message: m.delete_confirm_message(),
      onconfirm: () => {
        // delete in list order so each cleanup callback sees the remaining data
        for (const id of ids) {
          const index = data.findIndex((item) => item.id === id);
          if (index !== -1) {
            const [item] = data.splice(index, 1);
            ondelete?.(item);
          }
          selectedIds.delete(id);
        }
      }
    });
  }

  /**
   * Export selected data items in list order.
   */
  async function exportSelected() {
    if (!selectedCount || !onexport || exporting) {
      return;
    }
    // prevent repeated exports while the current operation is pending
    exporting = true;
    try {
      await onexport([...selectedItems]);
    } finally {
      exporting = false;
    }
  }

  /**
   * Move selected data items up or down by one position.
   *
   * @param direction - move up (-1) or down (1)
   */
  function moveSelected(direction: -1 | 1) {
    if (!selectedCount) {
      return;
    }
    const result = [...data];
    // preserve selection order by traversing from the top when moving up or the bottom when moving down
    for (
      let index = direction === -1 ? 1 : result.length - 2;
      index >= 0 && index < result.length;
      index -= direction
    ) {
      const neighbor = index + direction;
      if (
        neighbor >= 0 &&
        neighbor < result.length &&
        selectedIds.has(result[index].id) &&
        !selectedIds.has(result[neighbor].id)
      ) {
        [result[index], result[neighbor]] = [result[neighbor], result[index]];
      }
    }
    data = result;
    clearTimeout(scrollTimer);
    // scroll the leading selected row into view after the FLIP animation
    scrollTimer = setTimeout(() => {
      const rows = listElement?.querySelectorAll<HTMLLIElement>('[data-selected="true"]');
      const row = direction === -1 ? rows?.[0] : rows?.[rows.length - 1];
      row?.scrollIntoView({
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
          <CaretDownIcon class="size-4.5 swap-on" />
          <CaretRightIcon class="size-4.5 swap-off" />
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
        icon={PlusCircleIcon}
        iconWeight="bold"
        text="{m.add()}{name}"
        class="text-green-800"
        onclick={() => oncreate?.()}
      />
      <Button
        icon={XCircleIcon}
        iconWeight="bold"
        text={deleteText}
        class={selectedCount ? 'text-red-800' : 'btn-disabled'}
        disabled={!selectedCount}
        onclick={deleteSelected}
      />
      <Button
        icon={ArrowCircleUpIcon}
        iconWeight="bold"
        text={m.move_up()}
        class={selectedCount ? 'text-surface' : 'btn-disabled'}
        disabled={!selectedCount}
        onclick={() => moveSelected(-1)}
      />
      <Button
        icon={ArrowCircleDownIcon}
        iconWeight="bold"
        text={m.move_down()}
        class={selectedCount ? 'text-surface' : 'btn-disabled'}
        disabled={!selectedCount}
        onclick={() => moveSelected(1)}
      />
      {#if onimport || onexport}
        <div class="divider mx-0 my-auto divider-horizontal h-5 w-2 opacity-50"></div>
        {#if onimport}
          <Button
            icon={DownloadSimpleIcon}
            text="{m.import()}{name}"
            class="text-emphasis"
            onclick={() => onimport()}
          />
        {/if}
        {#if onexport}
          <Button
            icon={ShareIcon}
            text={exportText}
            class={selectedCount ? 'text-emphasis' : 'btn-disabled'}
            disabled={!selectedCount || exporting}
            onclick={exportSelected}
          />
        {/if}
      {/if}
    </span>
  </div>
  <!-- data list -->
  {#if !collapsed}
    <ul
      bind:this={listElement}
      class="list scrollbar-none overflow-y-auto bg-base-100 [&_.list-row]:min-h-10 [&_.list-row]:py-1"
      transition:slide={{ duration: 300 }}
    >
      {#if data.length === 0 && hint}
        <li class="list-row mx-auto items-center gap-1 text-surface/35">
          <LightbulbIcon class="size-3.5" />{hint}
        </li>
      {/if}
      {#each data as item, index (item.id)}
        {@const itemNum = (index + 1).toString().padStart(2, '0')}
        {@const evenIdx = index % 2 === 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="list-row cursor-pointer items-center rounded-none hover:bg-base-300 {evenIdx ? '' : 'bg-base-150'}"
          data-selected={selectedIds.has(item.id)}
          onclick={() => toggleSelection(item.id)}
          animate:flip={{ duration: 200 }}
        >
          <span class="flex items-center gap-1">
            <input
              type="checkbox"
              class="checkbox rounded-sm checkbox-xs"
              aria-label="{name}[{itemNum}]"
              checked={selectedIds.has(item.id)}
              onclick={(event) => event.stopPropagation()}
              onchange={() => toggleSelection(item.id)}
            />
            <span class="text-base font-thin {selectedIds.has(item.id) ? '' : 'opacity-60'}">{itemNum}</span>
          </span>
          {@render row(item)}
        </li>
      {/each}
    </ul>
  {/if}
</div>
