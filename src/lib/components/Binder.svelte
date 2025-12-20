<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert, Icon, Label, Modal, Select } from '$lib/components';
  import { MODEL_MARK, PROMPT_MARK, REGEXP_MARK, SCRIPT_MARK, SEARCHER_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, DEFAULT_ACTIONS, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import { manager } from '$lib/manager';
  import { GENERAL_CASES, NATURAL_CASES, PROGRAMMING_CASES, TEXT_CASES } from '$lib/matcher';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import { models, prompts, regexps, scripts, searchers, shortcuts } from '$lib/stores.svelte';
  import type { Option, Rule } from '$lib/types';
  import { ArrowArcRight, ArrowFatLineRight, Code, Sparkle, Translate } from 'phosphor-svelte';
  import { untrack } from 'svelte';

  // loading status
  const loading = new Loading();

  // shortcut to bind
  let shortcut: string = $state('');

  // rule binding modal
  let modal: Modal;
  export const showModal = (value: string) => {
    shortcut = value;
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

  // available cases
  const cases: Option[] = $derived.by(() => {
    const options: Option[] = [{ value: '', label: m.skip() }];
    // classification model
    if (models.current && models.current.length > 0) {
      options.push({ value: '--model--', label: `-- ${m.model()} --`, disabled: true });
      for (const model of models.current) {
        options.push({ value: MODEL_MARK + model.id, label: model.id, icon: model.icon });
      }
    }
    // regular expression
    if (regexps.current && regexps.current.length > 0) {
      options.push({ value: '--regexp--', label: `-- ${m.regexp()} --`, disabled: true });
      for (const regexp of regexps.current) {
        options.push({ value: REGEXP_MARK + regexp.id, label: regexp.id, icon: regexp.icon });
      }
    }
    // built-in type
    options.push({ value: '--general--', label: `-- ${m.general()} --`, disabled: true });
    options.push(...GENERAL_CASES);
    options.push({ value: '--text--', label: `-- ${m.text_case()} --`, disabled: true });
    options.push(...TEXT_CASES);
    options.push({ value: '--natural--', label: `-- ${m.natural_language()} --`, disabled: true });
    options.push(...NATURAL_CASES.map((c) => ({ ...c, icon: Translate })));
    options.push({ value: '--programming--', label: `-- ${m.programming_language()} --`, disabled: true });
    options.push(...PROGRAMMING_CASES.map((c) => ({ ...c, icon: Code })));
    return options;
  });

  // available actions
  const actions: Option[] = $derived.by(() => {
    const options: Option[] = [...DEFAULT_ACTIONS];
    // prompt
    if (prompts.current && prompts.current.length > 0) {
      options.push({ value: '--prompt--', label: `-- ${m.ai()} --`, disabled: true });
      for (const prompt of prompts.current) {
        options.push({ value: PROMPT_MARK + prompt.id, label: prompt.id, icon: prompt.icon });
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
        options.push({ value: SEARCHER_MARK + searcher.id, label: searcher.id, icon: searcher.icon });
      }
    }
    // built-in action
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
    const rules = shortcuts.current[shortcut]?.rules || [];

    // helper function to get used actions
    const getUsedActions = (value: string) => {
      return new Set(rules.filter((r) => r.case === value).map((r) => r.action));
    };

    // helper function to get unused actions
    const getUnusedActions = (value: string) => {
      return actions.filter((a) => !getUsedActions(value).has(a.value as string));
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
        const availableAction = unusedActions.find((a) => !a.disabled && a.value !== actionId);
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
  export function getActionOption(value: string): Option | undefined {
    return actions.find((a) => a.value === value);
  }

  /**
   * Register new rule.
   *
   * @param form - form element
   */
  export async function register(form: HTMLFormElement) {
    const s = shortcuts.current[shortcut];
    if (s.rules.find((r) => r.shortcut === shortcut && r.case === caseId && r.action === actionId)) {
      alert({ level: 'error', message: m.rule_already_used() });
      return;
    }
    loading.start();
    try {
      // close modal first
      modal.close();
      // register new rule
      await manager.register({
        id: crypto.randomUUID(),
        shortcut: shortcut,
        case: caseId,
        action: actionId
      });
      // reset form fields
      form.reset();
      alert(m.rule_added_success());
    } catch (error) {
      console.error(`Failed to register rule: ${error}`);
    } finally {
      loading.end();
    }
  }

  /**
   * Unregister rule.
   *
   * @param rule - rule object
   */
  export async function unregister(rule: Rule) {
    try {
      await manager.unregister(rule);
    } catch (error) {
      console.error(`Failed to unregister rule: ${error}`);
    }
  }
</script>

<Modal maxWidth="36rem" icon={Sparkle} title="{m.add()}{m.rule()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      register(formElement);
    }}
  >
    <fieldset class="fieldset">
      <div class="mt-4 grid grid-cols-11 gap-2">
        <!-- case selection -->
        <div class="col-span-5">
          <Label>{m.recognize_type()}</Label>
          <div class="flex items-center gap-1">
            <span class="flex size-8 shrink-0 rounded-field bg-base-200">
              {#if selectedCase?.icon}
                <Icon icon={selectedCase.icon} class="m-auto size-6" />
              {:else if caseId == ''}
                <Icon icon={ArrowArcRight} class="m-auto size-6 opacity-50" />
              {/if}
            </span>
            <Select bind:value={caseId} options={unusedCases} class="w-full select-sm" />
          </div>
        </div>

        <!-- arrow separator -->
        <div class="col-span-1 flex items-center justify-center">
          <ArrowFatLineRight class="size-6 opacity-15" />
        </div>

        <!-- action selection -->
        <div class="col-span-5">
          <Label>{m.execute_action()}</Label>
          <div class="flex items-center gap-1">
            <span class="flex size-8 shrink-0 rounded-field bg-base-200">
              {#if selectedAction?.icon}
                <Icon icon={selectedAction.icon} class="m-auto size-6" />
              {/if}
            </span>
            <Select bind:value={actionId} options={unusedActions} class="w-full select-sm" />
          </div>
        </div>
      </div>
    </fieldset>
    <div class="modal-action">
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
