<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button, Shortcut, Title, confirm } from '$lib/components';
  import { formatISO8601 } from '$lib/helpers';
  import { NoData } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { entries } from '$lib/stores.svelte';
  import type { Entry } from '$lib/types';
  import {
    ArrowFatLineRight,
    ArrowLeft,
    Broom,
    ClockCounterClockwise,
    CopySimple,
    Cube,
    FileJs,
    FilePy,
    FingerprintSimple,
    MagnifyingGlass,
    Robot,
    Textbox,
    Trash
  } from 'phosphor-svelte';
  import { flip } from 'svelte/animate';

  /**
   * Copy text to clipboard.
   *
   * @param text - text to copy
   */
  function copy(text: string | null | undefined) {
    text && navigator.clipboard && navigator.clipboard.writeText(text);
  }

  /**
   * Get action icon based on entry.
   *
   * @param entry - history entry
   */
  function getActionIcon(entry: Entry) {
    if (entry.actionType === 'prompt') return Robot;
    if (entry.actionType === 'searcher') return MagnifyingGlass;
    if (entry.scriptLang === 'javascript') return FileJs;
    if (entry.scriptLang === 'python') return FilePy;
    return null;
  }
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeft}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1">
    <ClockCounterClockwise class="size-5 opacity-80" />
    <span class="tracking-wider">{m.histories()}</span>
  </div>
  <Button
    size="sm"
    weight="duotone"
    icon={Broom}
    onclick={() => {
      if (entries.current.length === 0) {
        return;
      }
      confirm({
        message: m.clear_histories_message(),
        onconfirm: () => {
          entries.current = [];
        }
      });
    }}
  />
</Title>

{#if entries.current.length === 0}
  <div class="flex h-(--app-h) rounded-container">
    <NoData class="m-auto size-64 pl-4 opacity-10" />
  </div>
{:else}
  <div class="flex flex-col gap-3 overflow-y-auto">
    {#each entries.current as entry, index (entry.id)}
      {@const historyNum = (index + 1).toString().padStart(2, '0')}
      {@const promptMode = entry.actionType === 'prompt'}
      {@const actionIcon = getActionIcon(entry)}
      <div class="rounded-container" animate:flip={{ duration: 200 }}>
        <div class="flex items-center">
          <span class="text-lg font-thin text-primary/50">{historyNum}</span>
          <Shortcut small shortcut={entry.shortcut} class="ml-3 text-primary" />
          <time class="ml-3 text-sm text-emphasis/80">{formatISO8601(entry.datetime)}</time>
          <Button
            icon={Trash}
            size="sm"
            class="ml-auto text-emphasis"
            onclick={() => entries.current.splice(index, 1)}
          />
        </div>
        <div class="divider my-0 opacity-60"></div>
        <div class="grid grid-cols-[1fr_auto_1fr] gap-4">
          <div class="space-y-2">
            <div class="flex h-6 items-center gap-2">
              <Textbox class="size-4 opacity-80" />
              <span class="text-sm font-medium">{m.selected_text()}</span>
              {#if entry.caseLabel}
                <span class="badge gap-1 border badge-xs">
                  <FingerprintSimple class="size-3" />
                  {entry.caseLabel}
                </span>
              {/if}
            </div>
            <div class="h-14 overflow-auto overscroll-none rounded-box border bg-base-200 px-2 py-1 text-xs opacity-70">
              {entry.selection}
            </div>
          </div>
          <ArrowFatLineRight class="size-6 shrink-0 self-center opacity-20" />
          <div class="min-w-0 space-y-2">
            <div class="flex h-6 items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                {#if actionIcon}
                  {@const Icon = actionIcon}
                  <Icon class="size-4 shrink-0 opacity-80" />
                {/if}
                <span class="truncate text-sm font-medium" title={entry.actionLabel}>{entry.actionLabel}</span>
                {#if promptMode}
                  <span class="badge gap-1 border badge-xs">
                    <Cube class="size-3" />
                    {entry.model}
                  </span>
                {/if}
              </div>
              <Button icon={CopySimple} onclick={() => copy(entry.result)} />
            </div>
            <div class="h-14 overflow-auto overscroll-none rounded-box border bg-base-200 px-2 py-1 text-xs opacity-70">
              {entry.result}
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
