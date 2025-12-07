<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert, Label, Modal, Select } from '$lib/components';
  import { MODEL_MARK, PROMPT_MARK, REGEXP_MARK, SCRIPT_MARK } from '$lib/constants';
  import { CONVERT_ACTIONS, DEFAULT_ACTIONS, GENERAL_ACTIONS, PROCESS_ACTIONS } from '$lib/executor';
  import { manager } from '$lib/manager';
  import { GENERAL_CASES, NATURAL_CASES, PROGRAMMING_CASES, TEXT_CASES } from '$lib/matcher';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import { models, prompts, regexps, scripts, shortcuts } from '$lib/stores.svelte';
  import type { Option, Rule } from '$lib/types';
  import { ArrowFatLineRight, Code, FingerprintSimple, Sparkle, Translate } from 'phosphor-svelte';

  // loading status
  const loading = new Loading();

  // shortcut to bind
  let shortcut: string = $state('');

  // case identifier
  let caseId: string = $state('');

  // action identifier
  let actionId: string = $state('copy');

  // rule binding modal
  let modal: Modal;
  export const showModal = (value: string) => {
    shortcut = value;
    modal.show();
  };

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
    // script
    if (scripts.current && scripts.current.length > 0) {
      options.push({ value: '--script--', label: `-- ${m.script()} --`, disabled: true });
      for (const script of scripts.current) {
        options.push({ value: SCRIPT_MARK + script.id, label: script.id, icon: script.icon });
      }
    }
    // prompt
    if (prompts.current && prompts.current.length > 0) {
      options.push({ value: '--prompt--', label: `-- ${m.conversation()} --`, disabled: true });
      for (const prompt of prompts.current) {
        options.push({ value: PROMPT_MARK + prompt.id, label: prompt.id, icon: prompt.icon });
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
  async function register(form: HTMLFormElement) {
    const s = shortcuts.current[shortcut];
    if (s.rules.find((r) => r.shortcut === shortcut && r.case === caseId && r.action === actionId)) {
      alert({ level: 'error', message: m.rule_already_used() });
      return;
    }
    loading.start();
    try {
      await manager.register({
        id: crypto.randomUUID(),
        shortcut: shortcut,
        case: caseId,
        action: actionId
      });
      form.reset();
      modal.close();
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

<Modal icon={Sparkle} title="{m.add()}{m.rule()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      register(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label icon={FingerprintSimple} class="mt-4">{m.recognize_type()}</Label>
      <Select bind:value={caseId} options={cases} class="w-full" />
      <Label icon={ArrowFatLineRight} class="mt-4">{m.execute_action()}</Label>
      <Select bind:value={actionId} options={actions} class="w-full" />
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
