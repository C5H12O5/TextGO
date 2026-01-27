<script lang="ts" module>
  import { MODEL_MARK, PROMPT_MARK, REGEXP_MARK, SCRIPT_MARK, SEARCHER_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, DEFAULT_ACTIONS, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import { GENERAL_CASES, NATURAL_CASES, PROGRAMMING_CASES, TEXT_CASES } from '$lib/matcher';
  import type { ActOption, DisplayMode, Option, OutputMode, Rule } from '$lib/types';
  import { SvelteMap } from 'svelte/reactivity';

  // remember last choices for each shortcut
  type Binder = { caseId: string; actionId: string };
  const histories = new SvelteMap<string, Binder>();

  // dynamic font size based on text length
  const dynamicFontSize = (text: string) => {
    const length = text.length;
    // 5 chars or less: 14px, 15+ chars: 12px, linear interpolation in between
    const size = Math.max(12, Math.min(14, 14 - ((length - 5) / 10) * 2));
    return `${size}px`;
  };
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert, confirm, Icon, Label, Modal, Radio, Select, Toggle } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { manager } from '$lib/shortcut';
  import { Loading } from '$lib/states.svelte';
  import { models, prompts, regexps, scripts, searchers, shortcuts } from '$lib/stores.svelte';
  import {
    AppWindowIcon,
    ArrowArcRightIcon,
    ArrowFatLineRightIcon,
    ArrowSquareInIcon,
    ClipboardTextIcon,
    ClockCounterClockwiseIcon,
    SlidersHorizontalIcon,
    SparkleIcon,
    TextItalicIcon
  } from 'phosphor-svelte';
  import { untrack } from 'svelte';

  // loading status
  const loading = new Loading();

  // shortcut to bind
  let shortcut: string = $state('');

  // existing rules for the shortcut
  let rules: Rule[] = $derived(shortcuts.current[shortcut]?.rules || []);

  // rule identifier for update
  let ruleId: string = $state('');

  // show modal dialog
  let modal: Modal;
  export const showModal = (_shortcut: string, id?: string) => {
    shortcut = _shortcut;
    if (id) {
      // load existing rule if id is provided
      const rule = rules.find((r) => r.id === id);
      if (!rule) {
        return;
      }
      ruleId = id;
      caseId = rule.case;
      actionId = rule.action;
      displayMode = rule.displayMode || 'both';
      preview = rule.preview || false;
      outputMode = rule.outputMode;
      history = rule.history || false;
      clipboard = rule.clipboard || false;
    } else {
      // load last choices from history
      const history = histories.get(shortcut);
      if (history) {
        caseId = history.caseId;
        actionId = history.actionId;
      } else {
        caseId = '';
        actionId = 'copy';
      }
    }
    modal.show();
  };

  // case identifier
  let caseId: string = $state('');
  // action identifier
  let actionId: string = $state('copy');
  // current selected case option
  let selectedCase = $derived(getCaseOption(caseId));
  // current selected action option
  let selectedAction = $derived(getActionOption(actionId));

  // display and output modes
  let displayMode: DisplayMode = $state('both');
  let preview: boolean = $state(false);
  let outputMode: OutputMode | undefined = $state('replace');
  let history: boolean = $state(false);
  let clipboard: boolean = $state(false);

  // reset options when action changes
  $effect(() => {
    if (selectedAction && !ruleId) {
      untrack(() => {
        displayMode = 'both';
        preview = false;
        outputMode = selectedAction.noResult ? undefined : selectedAction.promptMode ? 'popup' : 'replace';
        history = !selectedAction.builtIn;
        clipboard = false;
      });
    }
  });

  // available cases
  const cases: Option[] = $derived.by(() => {
    // default
    const options: Option[] = [{ value: '', label: m.skip() }];

    // model
    if (models.current && models.current.length > 0) {
      options.push({ value: '--model--', label: `-- ${m.model()} --`, disabled: true });
      for (const model of models.current) {
        options.push({ value: MODEL_MARK + model.id, label: model.id, icon: model.icon });
      }
    }

    // regexp
    if (regexps.current && regexps.current.length > 0) {
      options.push({ value: '--regexp--', label: `-- ${m.regexp()} --`, disabled: true });
      for (const regexp of regexps.current) {
        options.push({ value: REGEXP_MARK + regexp.id, label: regexp.id, icon: regexp.icon });
      }
    }

    // built-in
    options.push({ value: '--general--', label: `-- ${m.general()} --`, disabled: true });
    options.push(...GENERAL_CASES);
    options.push({ value: '--text--', label: `-- ${m.text_case()} --`, disabled: true });
    options.push(...TEXT_CASES);
    options.push({ value: '--natural--', label: `-- ${m.natural_language()} --`, disabled: true });
    options.push(...NATURAL_CASES);
    options.push({ value: '--programming--', label: `-- ${m.programming_language()} --`, disabled: true });
    options.push(...PROGRAMMING_CASES);
    return options;
  });

  // available actions
  const actions: ActOption[] = $derived.by(() => {
    // default
    const options: ActOption[] = [...DEFAULT_ACTIONS];

    // prompt
    if (prompts.current && prompts.current.length > 0) {
      options.push({ value: '--prompt--', label: `-- ${m.ai()} --`, disabled: true });
      for (const prompt of prompts.current) {
        options.push({ value: PROMPT_MARK + prompt.id, label: prompt.id, icon: prompt.icon, promptMode: true });
      }
    }

    // script
    if (scripts.current && scripts.current.length > 0) {
      options.push({ value: '--script--', label: `-- ${m.script()} --`, disabled: true });
      for (const script of scripts.current) {
        options.push({ value: SCRIPT_MARK + script.id, label: script.id, icon: script.icon });
      }
    }

    // searcher
    if (searchers.current && searchers.current.length > 0) {
      options.push({ value: '--searcher--', label: `-- ${m.search()} --`, disabled: true });
      for (const searcher of searchers.current) {
        options.push({ value: SEARCHER_MARK + searcher.id, label: searcher.id, icon: searcher.icon, noResult: true });
      }
    }

    // built-in
    options.push({ value: '--general--', label: `-- ${m.general()} --`, disabled: true });
    options.push(...GENERAL_ACTIONS);
    options.push({ value: '--convert--', label: `-- ${m.text_case_convert()} --`, disabled: true });
    options.push(...CONVERT_ACTIONS);
    options.push({ value: '--process--', label: `-- ${m.text_processing()} --`, disabled: true });
    options.push(...PROCESS_ACTIONS);
    return options;
  });

  // unused cases and actions
  const { unusedCases, unusedActions } = $derived.by(() => {
    if (ruleId) {
      return { unusedCases: cases, unusedActions: actions };
    }

    // helper function to get used actions
    const getUsedActions = (value: string) => {
      return new Set(rules.filter((r) => r.case === value).map((r) => r.action));
    };

    // helper function to get unused actions
    const getUnusedActions = (value: string) => {
      const usedActions = getUsedActions(value);
      return actions.filter((a) => !usedActions.has(a.value as string));
    };

    // calculate total available actions
    const totalAvailableActions = actions.filter((a) => !a.disabled).length;

    // get unused cases
    const unusedCases = cases.filter(
      (c) => c.disabled || getUsedActions(c.value as string).size < totalAvailableActions
    );

    // check if current case is still available
    if (!unusedCases.some((c) => c.value === caseId)) {
      untrack(() => {
        const availableCase = unusedCases.find((c) => !c.disabled && c.value !== caseId);
        caseId = availableCase ? (availableCase.value as string) : '';
      });
    }

    // get unused actions
    const unusedActions = getUnusedActions(caseId);

    // check if current action is still available
    if (!unusedActions.some((a) => a.value === actionId)) {
      untrack(() => {
        // find the next available action starting from the current action
        let availableAction: Option | undefined;
        const currentIndex = actions.findIndex((a) => a.value === actionId);
        for (let i = 1; i < actions.length; i++) {
          const nextIndex = (currentIndex + i) % actions.length;
          const nextAction = actions[nextIndex];
          if (unusedActions.includes(nextAction) && !nextAction.disabled) {
            availableAction = nextAction;
            break;
          }
        }
        actionId = availableAction ? (availableAction.value as string) : 'copy';
      });
    }

    return { unusedCases, unusedActions };
  });

  /**
   * Get case option.
   *
   * @param value - case value
   * @returns option instance
   */
  export function getCaseOption(value: string): Option | undefined {
    return cases.find((c) => c.value === value);
  }

  /**
   * Get action option.
   *
   * @param value - action value
   * @returns option instance
   */
  export function getActionOption(value: string): ActOption | undefined {
    return actions.find((a) => a.value === value);
  }

  /**
   * Update rule options.
   */
  function update() {
    loading.start();
    try {
      // update options
      for (const rule of rules) {
        if (rule.id === ruleId) {
          rule.displayMode = displayMode;
          rule.preview = preview;
          rule.outputMode = outputMode;
          rule.history = history;
          rule.clipboard = clipboard;
          break;
        }
      }
      // close modal
      modal.close();
      alert(m.rule_updated_success());
    } catch (error) {
      console.error(`Failed to update rule: ${error}`);
    } finally {
      loading.end();
    }
  }

  /**
   * Bind rule to the shortcut.
   */
  async function bind() {
    if (rules.find((r) => r.shortcut === shortcut && r.case === caseId && r.action === actionId)) {
      alert({ level: 'error', message: m.rule_already_used() });
      return;
    }
    loading.start();
    try {
      // close modal
      modal.close();
      // register rule
      await manager.register({
        id: crypto.randomUUID(),
        shortcut: shortcut,
        case: caseId,
        action: actionId,
        // options
        displayMode: displayMode,
        preview: preview,
        outputMode: outputMode,
        history: history,
        clipboard: clipboard
      });
      // save history
      histories.set(shortcut, { caseId, actionId });
      alert(m.rule_added_success());
    } catch (error) {
      console.error(`Failed to bind rule: ${error}`);
    } finally {
      loading.end();
    }
  }

  /**
   * Unbind rule from the shortcut.
   *
   * @param rule - rule instance
   */
  export async function unbind(rule: Rule) {
    try {
      // unregister rule
      await manager.unregister(rule);
    } catch (error) {
      console.error(`Failed to unbind rule: ${error}`);
    }
  }

  /**
   * Clear all rules bound to the shortcut.
   *
   * @param shortcut - shortcut string
   */
  export async function clear(shortcut: string) {
    // unbind all rules
    const s = shortcuts.current[shortcut];
    if (s && s.rules) {
      for (const rule of s.rules) {
        await unbind(rule);
      }
    }
    // delete shortcut
    delete shortcuts.current[shortcut];
    // delete history
    histories.delete(shortcut);
  }
</script>

<Modal maxWidth="36.5rem" icon={SparkleIcon} title="{ruleId ? m.update() : m.add()}{m.rule()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ cancel }) => {
      cancel();
      ruleId ? update() : bind();
    }}
  >
    <fieldset class="fieldset">
      <div class="mt-4 grid grid-cols-11 gap-2">
        <!-- case selection -->
        <div class="col-span-5">
          <Label>{m.recognize_type()}</Label>
          <div class="flex items-center gap-1">
            <span class="flex size-8 shrink-0 rounded-field border bg-base-200 shadow-sm">
              {#if selectedCase?.icon}
                <Icon icon={selectedCase.icon} class="m-auto size-5" />
              {:else if caseId == ''}
                <Icon icon={ArrowArcRightIcon} class="m-auto size-6 opacity-50" />
              {/if}
            </span>
            <Select bind:value={caseId} options={unusedCases} class="select-sm shadow-sm" disabled={!!ruleId} />
          </div>
        </div>
        <!-- arrow separator -->
        <div class="col-span-1 flex items-center justify-center">
          <ArrowFatLineRightIcon class="size-6 opacity-15" />
        </div>
        <!-- action selection -->
        <div class="col-span-5">
          <Label>{m.execute_action()}</Label>
          <div class="flex items-center gap-1">
            <span class="flex size-8 shrink-0 rounded-field border bg-base-200 shadow-sm">
              {#if selectedAction?.icon}
                <Icon icon={selectedAction.icon} class="m-auto size-5" />
              {/if}
            </span>
            <Select bind:value={actionId} options={unusedActions} class="select-sm shadow-sm" disabled={!!ruleId} />
          </div>
        </div>
      </div>
    </fieldset>
    <fieldset class="fieldset rounded-box border p-4 pt-2">
      <legend class="fieldset-legend px-1 text-sm font-medium">
        <SlidersHorizontalIcon class="size-5" />
        {m.more_options()}
      </legend>
      <!-- toolbar options -->
      <div class="grid grid-cols-[6rem_1fr] items-start gap-4">
        <div class="flex h-7 items-center opacity-90" style="font-size:{dynamicFontSize(m.toolbar_display())}">
          {m.toolbar_display()}
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex gap-4">
            <Radio
              bind:group={displayMode}
              value="both"
              label={m.icon_and_label()}
              labelClass="text-sm"
              radioClass="radio-sm"
            />
            <Radio
              bind:group={displayMode}
              value="icon"
              label={m.icon_only()}
              labelClass="text-sm"
              radioClass="radio-sm"
            />
            <Radio
              bind:group={displayMode}
              value="label"
              label={m.label_only()}
              labelClass="text-sm"
              radioClass="radio-sm"
            />
          </div>
          <Toggle
            bind:value={preview}
            icon={ArrowSquareInIcon}
            iconClass="size-4"
            label={m.result_as_label()}
            labelClass="text-sm"
            toggleClass="toggle-xs"
            class="mt-2"
            disabled={selectedAction?.noResult || selectedAction?.promptMode}
          />
        </div>
      </div>
      <div class="divider my-1 opacity-50"></div>
      <!-- result options -->
      <div class="grid grid-cols-[6rem_1fr] items-start gap-4">
        <div class="flex h-7 items-center opacity-90" style="font-size:{dynamicFontSize(m.execution_result())}">
          {m.execution_result()}
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex gap-4">
            <Radio
              bind:group={outputMode}
              value="replace"
              icon={TextItalicIcon}
              iconClass="size-5"
              label={m.replace_selection()}
              labelClass="text-sm"
              radioClass="radio-sm"
              disabled={selectedAction?.noResult || selectedAction?.promptMode}
              onclick={(event) => {
                if (outputMode === 'replace') {
                  event.preventDefault();
                  outputMode = undefined;
                }
              }}
            />
            <Radio
              bind:group={outputMode}
              value="popup"
              icon={AppWindowIcon}
              iconClass="size-5"
              label={m.show_in_popup()}
              labelClass="text-sm"
              radioClass="radio-sm"
              disabled={selectedAction?.noResult}
              onclick={(event) => {
                if (outputMode === 'popup') {
                  event.preventDefault();
                  outputMode = undefined;
                }
              }}
            />
          </div>
          <Toggle
            bind:value={history}
            icon={ClockCounterClockwiseIcon}
            iconClass="size-4"
            label={m.save_to_history()}
            labelClass="text-sm"
            toggleClass="toggle-xs"
            class="mt-2"
          />
          <Toggle
            bind:value={clipboard}
            icon={ClipboardTextIcon}
            iconClass="size-4"
            label={m.copy_to_clipboard()}
            labelClass="text-sm"
            toggleClass="toggle-xs"
            disabled={selectedAction?.noResult || selectedAction?.promptMode}
          />
        </div>
      </div>
    </fieldset>
    <div class="modal-action">
      {#if ruleId}
        <button
          type="button"
          class="btn mr-auto btn-soft btn-error"
          onclick={() => {
            // confirm delete operation
            confirm({
              title: `${m.delete()}${m.rule()}`,
              message: m.delete_confirm_message(),
              onconfirm: () => {
                const rule = rules.find((r) => r.id === ruleId);
                if (rule) {
                  unbind(rule);
                  modal.close();
                }
              }
            });
          }}
        >
          {m.delete()}
        </button>
      {/if}
      <button type="button" class="btn" onclick={() => modal?.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit" disabled={loading.started}>
        {m.confirm()}
        {#if loading.delayed}
          <span class="loading loading-xs loading-dots"></span>
        {/if}
      </button>
    </div>
  </form>
</Modal>
