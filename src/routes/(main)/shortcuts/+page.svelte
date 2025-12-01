<script lang="ts">
  import { alert, Binder, Button, confirm, List, Recorder, Shortcut } from '$lib/components';
  import { MODEL_MARK, PROMPT_MARK, REGEXP_MARK, SCRIPT_MARK } from '$lib/constants';
  import { formatShortcut } from '$lib/helpers';
  import { JavaScript, LMStudio, NoData, Ollama, Python, Regexp, Tensorflow } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { prompts, scripts, shortcuts } from '$lib/stores.svelte';
  import {
    ArrowArcRight,
    ArrowCircleRight,
    ArrowFatLineRight,
    ArrowsClockwise,
    Browser,
    FingerprintSimple,
    Sparkle,
    StackPlus,
    Trash,
    Warning
  } from 'phosphor-svelte';
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';

  // total number of rules
  let totalRules = $derived(Object.values(shortcuts.current).reduce((sum, s) => sum + s.rules.length, 0));

  // shortcut recorder
  let recorder: Recorder;

  // rule binder
  let binder: Binder | null = $state(null);

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
      mode: 'quiet',
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
   * Swap shortcut execution mode.
   *
   * @param shortcut - registered shortcut string
   */
  function swapMode(shortcut: string) {
    const s = shortcuts.current[shortcut];
    s.mode = s.mode === 'toolbar' ? 'quiet' : 'toolbar';
  }

  /**
   * Get script by action ID.
   *
   * @param action - action ID
   */
  function getScript(action: string) {
    const id = action.substring(SCRIPT_MARK.length);
    return scripts.current.find((item) => item.id === id);
  }

  /**
   * Get prompt by action ID.
   *
   * @param action - action ID
   */
  function getPrompt(action: string) {
    const id = action.substring(PROMPT_MARK.length);
    return prompts.current.find((item) => item.id === id);
  }

  // control display delay when no data to avoid flickering
  let showNoData = $state(false);
  onMount(() => {
    setTimeout(() => {
      showNoData = true;
    }, 100);
  });
</script>

<div class="relative min-h-(--app-h) rounded-container">
  <div class="flex items-center justify-between">
    <span class="pl-1 text-sm opacity-60">
      {m.shortcuts_count()}: {Object.keys(shortcuts.current).length}
      {#if totalRules > 0}
        <span class="text-xs tracking-wider opacity-50">({m.rules_count({ count: totalRules })})</span>
      {/if}
    </span>
    <button class="btn text-sm btn-sm btn-submit" onclick={() => recorder.showModal()}>
      <StackPlus class="size-5" />{m.register_shortcut()}
    </button>
  </div>
  {#if showNoData && Object.keys(shortcuts.current).length === 0}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <NoData class="m-auto size-64 pl-4 opacity-10" />
    </div>
  {/if}
  {#each Object.keys(shortcuts.current).sort() as shortcut (shortcut)}
    {@const mode = shortcuts.current[shortcut].mode}
    {@const rules = shortcuts.current[shortcut].rules}
    <div data-shortcut={shortcut} in:fly={{ x: -15, duration: 150 }} out:fly={{ x: 15, duration: 150 }}>
      <div class="flex items-center gap-4 pt-8 pb-2">
        <Shortcut {shortcut} />
        <button
          class="group badge cursor-pointer bg-base-200 text-emphasis/80 transition-colors hover:text-emphasis"
          onclick={() => swapMode(shortcut)}
        >
          <label class="swap swap-rotate group-hover:swap-active">
            <ArrowsClockwise class="swap-on size-4" />
            <ArrowCircleRight class="swap-off size-4" />
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
          icon={Trash}
          class="ml-auto text-emphasis"
          text={m.delete_shortcut()}
          onclick={() => {
            const clear = () => {
              for (const item of rules) {
                binder?.unregister(item);
              }
              delete shortcuts.current[shortcut];
            };
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
        hint={m.rule_hint()}
        bind:data={shortcuts.current[shortcut].rules}
        oncreate={() => binder?.showModal(shortcut)}
        ondelete={(item) => binder?.unregister(item)}
      >
        {#snippet title()}
          <Sparkle class="mx-1 size-4 opacity-60" />
          <span class="text-sm tracking-wide opacity-60">
            {#if rules.length > 0}
              {m.rules_count({ count: rules.length })}
            {:else}
              {m.rules_empty()}
            {/if}
          </span>
        {/snippet}
        {#snippet row(item)}
          {@const { label: caseLabel, icon: caseIcon } = binder?.getCaseOption(item.case) ?? {}}
          {@const { label: actionLabel, icon: actionIcon } = binder?.getActionOption(item.action) ?? {}}
          <div class="list-col-grow flex items-center gap-4 pl-4">
            <div class="flex w-1/2 items-center gap-1.5 truncate" title={caseLabel}>
              {#if item.case === ''}
                <!-- default type -->
                <ArrowArcRight class="size-5 shrink-0 opacity-30" />
                <span class="truncate opacity-30">{caseLabel}</span>
              {:else if !caseLabel}
                <!-- invalid type -->
                <Warning class="size-5 shrink-0 opacity-50" />
                <span class="truncate opacity-50">{m.invalid_type()}</span>
              {:else}
                <!-- type name -->
                {#if item.case.startsWith(MODEL_MARK)}
                  <Tensorflow class="h-5 shrink-0" />
                {:else if item.case.startsWith(REGEXP_MARK)}
                  <Regexp class="h-5 shrink-0" />
                {:else if caseIcon}
                  {@const CaseIcon = caseIcon}
                  <CaseIcon class="size-5 shrink-0 text-emphasis/60" />
                {:else}
                  <FingerprintSimple class="size-5 shrink-0 text-emphasis/60" />
                {/if}
                <span class="truncate text-base-content/80">{caseLabel}</span>
              {/if}
            </div>
            <ArrowFatLineRight class="size-5 shrink-0 opacity-15 sm:mx-1 md:mx-2 lg:mx-3 xl:mx-4 2xl:mx-5" />
            <div class="flex w-1/2 items-center gap-1.5 truncate" title={actionLabel}>
              {#if item.action === ''}
                <!-- default action -->
                <Browser class="size-5 shrink-0 opacity-30" />
                <span class="truncate opacity-30">{actionLabel}</span>
              {:else if !actionLabel}
                <!-- invalid action -->
                <Warning class="size-5 shrink-0 opacity-50" />
                <span class="truncate opacity-50">{m.invalid_action()}</span>
              {:else}
                <!-- action name -->
                {#if item.action.startsWith(SCRIPT_MARK)}
                  {@const script = getScript(item.action)}
                  {#if script?.lang === 'javascript'}
                    <JavaScript class="h-5 shrink-0" />
                  {:else if script?.lang === 'python'}
                    <Python class="h-5 shrink-0" />
                  {/if}
                {:else if item.action.startsWith(PROMPT_MARK)}
                  {@const prompt = getPrompt(item.action)}
                  {#if prompt?.provider === 'ollama'}
                    <Ollama class="h-5 shrink-0" />
                  {:else if prompt?.provider === 'lmstudio'}
                    <LMStudio class="h-5 shrink-0" />
                  {/if}
                {:else if actionIcon}
                  {@const ActionIcon = actionIcon}
                  <ActionIcon class="size-5 shrink-0 text-emphasis/60" />
                {/if}
                <span class="truncate text-base-content/80">{actionLabel}</span>
              {/if}
            </div>
          </div>
        {/snippet}
      </List>
    </div>
  {/each}
</div>

<Recorder bind:this={recorder} onrecord={register} />

<Binder bind:this={binder} />
