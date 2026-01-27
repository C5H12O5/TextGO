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
    ArrowFatLineRightIcon,
    ArrowLeftIcon,
    BroomIcon,
    ClockCounterClockwiseIcon,
    CopySimpleIcon,
    CubeIcon,
    FileJsIcon,
    FilePyIcon,
    FingerprintSimpleIcon,
    MagnifyingGlassIcon,
    RobotIcon,
    TerminalWindowIcon,
    TextboxIcon,
    TrashIcon
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
    if (entry.actionType === 'prompt') return RobotIcon;
    if (entry.actionType === 'searcher') return MagnifyingGlassIcon;
    if (entry.scriptLang === 'javascript') return FileJsIcon;
    if (entry.scriptLang === 'python') return FilePyIcon;
    if (entry.scriptLang?.endsWith('shell')) return TerminalWindowIcon;
    return null;
  }
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeftIcon}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1">
    <ClockCounterClockwiseIcon class="size-5 opacity-80" />
    <span class="tracking-wider">{m.histories()}</span>
  </div>
  <Button
    size="sm"
    icon={BroomIcon}
    iconWeight="duotone"
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
          <span class="text-lg font-thin opacity-25">{historyNum}</span>
          <Shortcut small shortcut={entry.shortcut} class="ml-3 text-shortcut" />
          <time class="ml-3 text-sm text-emphasis/50">{formatISO8601(entry.datetime)}</time>
          <Button
            icon={TrashIcon}
            size="sm"
            class="ml-auto text-emphasis"
            onclick={() => entries.current.splice(index, 1)}
          />
        </div>
        <div class="divider my-0 opacity-60"></div>
        <div class="grid grid-cols-[1fr_auto_1fr] gap-4">
          <div class="min-w-0 space-y-2">
            <div class="flex h-6 items-center gap-2">
              <TextboxIcon class="size-4.5 shrink-0 opacity-80" />
              <span class="truncate text-sm opacity-60">{m.selected_text()}</span>
              {#if entry.caseLabel}
                <span class="badge min-w-14 gap-1 truncate border badge-xs opacity-80" title={entry.caseLabel}>
                  <FingerprintSimpleIcon class="size-3 shrink-0" />
                  <span class="truncate">{entry.caseLabel}</span>
                </span>
              {/if}
            </div>
            <div class="h-14 overflow-auto overscroll-none rounded-box border bg-base-200 px-2 py-1 text-xs opacity-70">
              {entry.selection}
            </div>
          </div>
          <ArrowFatLineRightIcon class="size-6 shrink-0 self-center opacity-20" />
          <div class="min-w-0 space-y-2">
            <div class="flex h-6 items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                {#if actionIcon}
                  {@const Icon = actionIcon}
                  <Icon class="size-4.5 shrink-0 opacity-80" />
                {/if}
                <span class="truncate text-sm font-medium" title={entry.actionLabel}>{entry.actionLabel}</span>
                {#if promptMode}
                  <span class="badge min-w-14 gap-1 truncate border badge-xs" title={entry.model}>
                    <CubeIcon class="size-3 shrink-0" />
                    <span class="truncate">{entry.model}</span>
                  </span>
                {/if}
              </div>
              <Button icon={CopySimpleIcon} onclick={() => copy(entry.result)} />
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
