<script lang="ts">
  import { alert, Binder, Button, BWList, confirm, Icon, List, Recorder, Shortcut } from '$lib/components';
  import { DBCLICK_SHORTCUT, DRAG_SHORTCUT, SHIFT_CLICK_SHORTCUT } from '$lib/constants';
  import { formatShortcut, isMouseShortcut } from '$lib/helpers';
  import { NoData } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { blacklist, shortcuts } from '$lib/stores.svelte';
  import {
    ArrowArcRightIcon,
    ArrowCircleRightIcon,
    ArrowFatLineRightIcon,
    ArrowFatUpIcon,
    ArrowsClockwiseIcon,
    BrowserIcon,
    GearSixIcon,
    KeyboardIcon,
    MouseLeftClickIcon,
    ProhibitIcon,
    SparkleIcon,
    StackPlusIcon,
    TrashIcon,
    WarningIcon,
    WaveSineIcon
  } from 'phosphor-svelte';
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';

  // total number of rules
  let totalRules = $derived(Object.values(shortcuts.current).reduce((sum, s) => sum + s.rules.length, 0));

  // shortcut recorder
  let recorder: Recorder;

  // rule binder
  let ruleBinder: Binder | null = $state(null);

  // rule updater
  let ruleUpdater: Binder | null = $state(null);

  // blacklist manager
  let blacklistManager: BWList;

  // dropdown element
  let dropdown: HTMLDetailsElement;
  let dropdownOpen: boolean = $state(false);

  /**
   * Register new shortcut.
   *
   * @param shortcut - shortcut string to register
   */
  async function register(shortcut: string) {
    if (!shortcut) {
      return;
    }

    // check duplicate
    if (shortcuts.current[shortcut]) {
      alert({ level: 'error', message: m.shortcut_already_registered() });
      return;
    }

    // register new shortcut
    shortcuts.current[shortcut] = {
      mode: isMouseShortcut(shortcut) ? 'toolbar' : 'quiet',
      rules: []
    };

    // wait for DOM update then scroll to newly registered shortcut position
    await tick();
    const element = document.querySelector(`[data-shortcut="${shortcut}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Compare two shortcut strings for sorting.
   *
   * @param a - first shortcut string
   * @param b - second shortcut string
   */
  function compareShortcut(a: string, b: string) {
    if (a === DRAG_SHORTCUT) return -1;
    if (b === DRAG_SHORTCUT) return 1;
    if (a === DBCLICK_SHORTCUT) return -1;
    if (b === DBCLICK_SHORTCUT) return 1;
    if (a === SHIFT_CLICK_SHORTCUT) return -1;
    if (b === SHIFT_CLICK_SHORTCUT) return 1;
    return a.localeCompare(b);
  }

  /**
   * Get shortcut hint text.
   *
   * @param shortcut - shortcut string
   */
  function shortcutHint(shortcut: string) {
    if (shortcut === DRAG_SHORTCUT) return m.mouse_drag_hint();
    if (shortcut === DBCLICK_SHORTCUT) return m.mouse_dbclick_hint();
    if (shortcut === SHIFT_CLICK_SHORTCUT) return m.mouse_shift_click_hint();
    return m.keyboard_shortcut_hint();
  }

  // control display delay when no data to avoid flickering
  let showNoData = $state(false);
  onMount(() => {
    setTimeout(() => {
      showNoData = true;
    }, 100);
  });
</script>

<svelte:window
  onclick={(event) => {
    // close the dropdown when clicking outside of it
    if (event.target instanceof Node && !dropdown.contains(event.target)) {
      dropdownOpen = false;
    }
  }}
/>

<div class="relative min-h-(--app-h) rounded-container">
  <div class="flex items-center gap-2">
    <span class="pl-1 text-sm opacity-60">
      {m.shortcuts_count()}: {Object.keys(shortcuts.current).length}
      {#if totalRules > 0}
        <span class="text-xs tracking-wider opacity-50">({m.rule_count({ count: totalRules })})</span>
      {/if}
    </span>
    <button class="btn ml-auto btn-soft btn-sm" onclick={() => blacklistManager.showModal()}>
      <ProhibitIcon class="size-5" />
      <span class="text-sm font-normal">{m.blacklist()}</span>
    </button>
    <details class="dropdown dropdown-end" bind:this={dropdown} bind:open={dropdownOpen}>
      <summary
        class="btn text-sm btn-sm btn-submit"
        onclick={(event) => {
          if (
            shortcuts.current[DRAG_SHORTCUT] &&
            shortcuts.current[DBCLICK_SHORTCUT] &&
            shortcuts.current[SHIFT_CLICK_SHORTCUT]
          ) {
            // all mouse shortcuts are registered, open recorder directly
            event.preventDefault();
            recorder.showModal();
          }
        }}
      >
        <StackPlusIcon class="size-5" />{m.register_shortcut()}
      </summary>
      <ul class="dropdown-content menu z-1 mt-1 min-w-42 gap-1 rounded-box border bg-base-100 p-1 shadow-lg">
        <!-- mouse drag-select option -->
        <li class={shortcuts.current[DRAG_SHORTCUT] ? 'hidden' : ''}>
          <button
            class="btn px-1 btn-sm"
            onclick={() => {
              register(DRAG_SHORTCUT);
              dropdownOpen = false;
            }}
          >
            <span class="flex">
              <MouseLeftClickIcon class="size-4" />
              <WaveSineIcon class="size-4" />
            </span>
            <span class="mx-auto tracking-wider">{m.mouse_drag()}</span>
          </button>
        </li>
        <!-- mouse double-click option -->
        <li class={shortcuts.current[DBCLICK_SHORTCUT] ? 'hidden' : ''}>
          <button
            class="btn px-1 btn-sm"
            onclick={() => {
              register(DBCLICK_SHORTCUT);
              dropdownOpen = false;
            }}
          >
            <span class="flex">
              <MouseLeftClickIcon class="size-4" />
              <MouseLeftClickIcon class="size-4" />
            </span>
            <span class="mx-auto tracking-wider">{m.mouse_dbclick()}</span>
          </button>
        </li>
        <!-- mouse shift-click option -->
        <li class={shortcuts.current[SHIFT_CLICK_SHORTCUT] ? 'hidden' : ''}>
          <button
            class="btn px-1 btn-sm"
            onclick={() => {
              register(SHIFT_CLICK_SHORTCUT);
              dropdownOpen = false;
            }}
          >
            <span class="flex">
              <ArrowFatUpIcon class="size-4" />
              <MouseLeftClickIcon class="size-4" />
            </span>
            <span class="mx-auto tracking-wider">{m.mouse_shift_click()}</span>
          </button>
        </li>
        <!-- keyboard shortcut option -->
        <li>
          <button
            class="btn px-1 btn-sm"
            onclick={() => {
              recorder.showModal();
              dropdownOpen = false;
            }}
          >
            <KeyboardIcon class="mx-1.75 size-4.5" />
            <span class="mx-auto tracking-wider">{m.keyboard_keys()}</span>
          </button>
        </li>
      </ul>
    </details>
  </div>
  {#if showNoData && Object.keys(shortcuts.current).length === 0}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <NoData class="m-auto size-64 pl-4 opacity-10" />
    </div>
  {/if}
  {#each Object.keys(shortcuts.current).sort(compareShortcut) as shortcut (shortcut)}
    {@const mode = shortcuts.current[shortcut].mode}
    {@const rules = shortcuts.current[shortcut].rules}
    <div data-shortcut={shortcut} in:fly={{ x: -15, duration: 150 }} out:fly={{ x: 15, duration: 150 }}>
      <div class="flex items-center gap-4 pt-8 pb-2">
        <Shortcut {shortcut} class="text-shortcut" />
        <button
          class="group badge cursor-pointer bg-base-200 opacity-80 transition-all hover:opacity-100"
          class:border={mode === 'toolbar'}
          class:gradient={mode === 'toolbar'}
          class:shadow-sm={mode === 'toolbar'}
          class:text-inactive={mode !== 'toolbar'}
          onclick={() => {
            // swap shortcut execution mode
            const s = shortcuts.current[shortcut];
            s.mode = s.mode === 'toolbar' ? 'quiet' : 'toolbar';
          }}
        >
          <label class="swap swap-rotate group-hover:swap-active">
            <ArrowsClockwiseIcon weight="bold" class="swap-on size-4" />
            <ArrowCircleRightIcon weight="bold" class="swap-off size-4" />
          </label>
          <span class="text-sm">
            {#if mode === 'toolbar'}
              {m.toolbar_mode()}
            {:else}
              {m.quiet_mode()}
            {/if}
          </span>
        </button>
        <Button
          icon={TrashIcon}
          size="sm"
          class="ml-auto text-emphasis"
          text={m.delete_shortcut()}
          onclick={() => {
            const clear = () => ruleBinder?.clear(shortcut);
            // delete directly if rule is empty, otherwise need confirmation
            if (rules.length > 0) {
              confirm({
                title: m.delete_shortcut_title({ shortcut: formatShortcut(shortcut) }),
                message: m.delete_confirm_message(),
                onconfirm: clear
              });
            } else {
              clear();
            }
          }}
        />
      </div>
      <List
        name={m.rule()}
        hint={shortcutHint(shortcut)}
        bind:data={shortcuts.current[shortcut].rules}
        bind:collapsed={shortcuts.current[shortcut].collapsed}
        collapsible
        oncreate={() => ruleBinder?.showModal(shortcut)}
        ondelete={(item) => ruleBinder?.unbind(item)}
      >
        {#snippet title()}
          <SparkleIcon class="mx-1 size-4 opacity-60" />
          <span class="text-sm tracking-wide opacity-60">
            {#if rules.length > 0}
              {m.rule_count({ count: rules.length })}
            {:else}
              {m.rule_empty()}
            {/if}
          </span>
        {/snippet}
        {#snippet row(item)}
          {@const { label: caseLabel, icon: caseIcon } = ruleBinder?.getCaseOption(item.case) ?? {}}
          {@const { label: actionLabel, icon: actionIcon } = ruleBinder?.getActionOption(item.action) ?? {}}
          <div class="list-col-grow grid grid-cols-12 items-center gap-4 pl-4">
            <div class="col-span-5 flex items-center gap-1.5" title={caseLabel}>
              {#if item.case === ''}
                <!-- default type -->
                <ArrowArcRightIcon class="size-5 shrink-0 opacity-30" />
                <span class="truncate opacity-30">{caseLabel}</span>
              {:else if !caseLabel}
                <!-- invalid type -->
                <WarningIcon class="size-5 shrink-0 opacity-50" />
                <span class="truncate line-through opacity-50">
                  {item.case.substring(item.case.indexOf('-') + 1)}
                </span>
              {:else}
                <!-- valid type -->
                {#if caseIcon}
                  <Icon icon={caseIcon} class="size-5 shrink-0" />
                {/if}
                <span class="truncate opacity-80">{caseLabel}</span>
              {/if}
            </div>
            <div class="col-span-1 flex items-center justify-center">
              <ArrowFatLineRightIcon class="size-5 shrink-0 opacity-15" />
            </div>
            <div class="col-span-6 flex items-center gap-1.5" title={actionLabel}>
              {#if item.action === ''}
                <!-- default action -->
                <BrowserIcon class="size-5 shrink-0 opacity-30" />
                <span class="truncate opacity-30">{actionLabel}</span>
              {:else if !actionLabel}
                <!-- invalid action -->
                <WarningIcon class="size-5 shrink-0 opacity-50" />
                <span class="truncate line-through opacity-50">
                  {item.action.substring(item.action.indexOf('-') + 1)}
                </span>
              {:else}
                <!-- valid action -->
                {#if actionIcon}
                  <Icon icon={actionIcon} class="size-5 shrink-0" />
                {/if}
                <span class="truncate opacity-80">{actionLabel}</span>
              {/if}
            </div>
          </div>
          <Button
            icon={GearSixIcon}
            iconWeight="fill"
            onclick={(event) => {
              event.stopPropagation();
              ruleUpdater?.showModal(shortcut, item.id);
            }}
          />
        {/snippet}
      </List>
    </div>
  {/each}
</div>

<Recorder bind:this={recorder} onrecord={register} />

<Binder bind:this={ruleBinder} />

<Binder bind:this={ruleUpdater} />

<BWList bind:this={blacklistManager} bind:list={blacklist.current} />
