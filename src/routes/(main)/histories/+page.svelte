<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button, Shortcut, Title } from '$lib/components';
  import { formatISO8601 } from '$lib/helpers';
  import { NoData } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { entries } from '$lib/stores.svelte';
  import type { Entry } from '$lib/types';
  import {
    ArrowFatLineRight,
    ArrowLeft,
    ClockCounterClockwise,
    CopySimple,
    Cube,
    FileJs,
    FileMd,
    FilePy,
    FingerprintSimple,
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
    if (entry.actionType === 'prompt') return FileMd;
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
</Title>

{#if entries.current.length === 0}
  <div class="flex h-(--app-h) rounded-container">
    <NoData class="m-auto size-64 pl-4 opacity-10" />
  </div>
{:else}
  <div class="flex flex-col gap-3 overflow-y-auto">
    {#each entries.current as entry, index (entry.id)}
      {@const promptMode = entry.actionType === 'prompt'}
      {@const actionIcon = getActionIcon(entry)}
      <div class="rounded-container" animate:flip={{ duration: 200 }}>
        <div class="flex items-center">
          <Shortcut shortcut={entry.shortcut} class="[&_kbd]:kbd-sm" />
          <time class="ml-3 text-sm opacity-30">{formatISO8601(entry.datetime)}</time>
          <Button class="ml-auto" size="sm" icon={Trash} onclick={() => entries.current.splice(index, 1)} />
        </div>
        <div class="divider my-0 opacity-60"></div>
        <div class="grid grid-cols-[1fr_auto_1fr] gap-4">
          <div class="space-y-2">
            <div class="flex h-6 items-center gap-2">
              <Textbox class="size-4 opacity-60" />
              <span class="text-sm font-semibold">{m.selected_text()}</span>
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
          <div class="space-y-2">
            <div class="flex h-6 items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                {#if actionIcon}
                  {@const Icon = actionIcon}
                  <Icon class="size-4 opacity-60" />
                {/if}
                <span class="text-sm font-semibold">{entry.actionLabel}</span>
                {#if promptMode}
                  <span class="badge gap-1 border badge-xs">
                    <Cube class="size-3" />
                    {entry.model}
                  </span>
                {/if}
              </div>
              <Button icon={CopySimple} weight="thin" onclick={() => copy(entry.result)} />
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
