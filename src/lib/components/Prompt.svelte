<script lang="ts" module>
  import { m } from '$lib/paraglide/messages';
  import type { Prompt } from '$lib/types';

  /**
   * Prompt template variable explanation.
   */
  const PROMPT_PLACEHOLDER = `
${m.prompt_variables_tip()}
{{clipboard}} - ${m.clipboard_text()}
{{selection}} - ${m.selected_text()}
`.trimStart();
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { CodeMirror, Label, Modal, Select, alert } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { Loading } from '$lib/states.svelte';
  import { markdown } from '@codemirror/lang-markdown';
  import { ArrowFatLineRight, Cube, HeadCircuit, Lightbulb } from 'phosphor-svelte';

  const { prompts }: { prompts: Prompt[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text }) => ({
    name: text().maxlength(64),
    modelName: text().maxlength(32)
  }));

  let promptId: string = $state('');
  let promptName: string = $state('');
  let promptText: string = $state('');
  let systemPromptText: string = $state('');
  let modelProvider: 'ollama' | 'lmstudio' = $state('ollama');
  let modelName: string = $state('gemma3:4b');

  let modal: Modal;
  let nameInputElement: HTMLInputElement;
  let collapseCheckbox: HTMLInputElement;
  export const showModal = (id?: string) => {
    if (id) {
      const prompt = prompts.find((p) => p.id === id);
      if (prompt) {
        promptId = id;
        promptName = prompt.id;
        promptText = prompt.prompt;
        systemPromptText = prompt.systemPrompt || '';
        modelProvider = prompt.provider;
        modelName = prompt.model;
      }
    }
    modal.show();
  };

  /**
   * Save prompt to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    promptName = promptName.trim();
    const prompt = prompts.find((p) => p.id === promptName);
    if (prompt && prompt.id !== promptId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    if (!promptText || promptText.trim().length === 0) {
      alert({ level: 'error', message: m.prompt_content_empty() });
      return;
    }
    loading.start();
    if (prompt) {
      // update prompt
      prompt.prompt = promptText;
      prompt.systemPrompt = systemPromptText;
      prompt.provider = modelProvider;
      prompt.model = modelName;
      alert(m.prompt_updated_success());
    } else {
      // add new prompt
      prompts.push({
        id: promptName,
        prompt: promptText,
        systemPrompt: systemPromptText,
        provider: modelProvider,
        model: modelName
      });
      // reset form
      promptName = '';
      promptText = '';
      systemPromptText = '';
      modelProvider = 'ollama';
      modelName = 'gemma3:4b';
      alert(m.prompt_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal icon={Lightbulb} title="{promptId ? m.update() : m.add()}{m.prompt_template()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.action_name()}</Label>
      <label class="input w-full">
        <ArrowFatLineRight class="size-5 opacity-50" />
        <input
          class="autofocus grow"
          {...schema.name}
          bind:value={promptName}
          bind:this={nameInputElement}
          disabled={!!promptId}
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <span>
          <Label required>{m.model_provider()}</Label>
          <Select
            bind:value={modelProvider}
            options={[
              { value: 'ollama', label: 'Ollama' },
              { value: 'lmstudio', label: 'LM Studio' }
            ]}
            class="w-full"
            disabled={true}
          />
        </span>
        <span>
          <Label required>{m.model_name()}</Label>
          <label class="input w-full">
            <Cube class="size-5 opacity-50" />
            <input class="grow" {...schema.modelName} bind:value={modelName} />
          </label>
        </span>
      </div>
      <Label required tip={m.prompt_tip()}>{m.prompt()}</Label>
      <CodeMirror
        title={m.prompt()}
        language={markdown()}
        placeholder={PROMPT_PLACEHOLDER}
        bind:document={promptText}
      />
      <div class="collapse-arrow collapse mt-2 border">
        <input type="checkbox" class="peer" bind:this={collapseCheckbox} />
        <div class="collapse-title border-b-transparent transition-all duration-200 peer-checked:border-b">
          <HeadCircuit class="size-5" />
          {m.system_prompt_explain()}
        </div>
        <div class="collapse-content p-0!">
          <CodeMirror
            title={m.system_prompt()}
            language={markdown()}
            bind:document={systemPromptText}
            class="rounded-t-none border-x-0 border-b-0"
          />
        </div>
      </div>
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit" disabled={loading.started}>
        {m.confirm()}
        {#if loading.delayed}
          <span class="loading loading-xs loading-dots"></span>
        {/if}
      </button>
    </div>
  </form>
</Modal>
