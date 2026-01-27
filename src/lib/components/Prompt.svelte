<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import type { LLMProvider, Prompt } from '$lib/types';

  /**
   * Prompt template variable explanation.
   */
  const PROMPT_PLACEHOLDER = `
${m.prompt_variables_tip()}
{{clipboard}} - ${m.clipboard_text()}
{{selection}} - ${m.selected_text()}
`.trimStart();

  // form schema
  const schema = buildFormSchema(({ text, number, range }) => ({
    name: text().maxlength(64),
    modelName: text().maxlength(64),
    maxTokens: number().min(1).required(false),
    temperature: range().min(0).max(2).step(0.1).required(false),
    topP: range().min(0).max(1).step(0.1).required(false)
  }));

  // default values
  const DEFAULT_ICON = 'Robot';
  const DEFAULT_MODEL = 'gemma3:4b';
  const DEFAULT_PROVIDER = 'ollama';
  const DEFAULT_TEMPERATURE = 1;
  const DEFAULT_TOP_P = 1;
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { CodeMirror, IconSelector, Label, Modal, Select, alert } from '$lib/components';
  import { PROMPT_MARK } from '$lib/constants';
  import { updateActionId } from '$lib/shortcut';
  import { Loading } from '$lib/states.svelte';
  import { anthropicApiKey, geminiApiKey, openaiApiKey, openrouterApiKey, xaiApiKey } from '$lib/stores.svelte';
  import { markdown } from '@codemirror/lang-markdown';
  import { CubeIcon, SlidersHorizontalIcon } from 'phosphor-svelte';

  const { prompts }: { prompts: Prompt[] } = $props();
  const loading = new Loading();

  let promptId: string = $state('');
  let promptName: string = $state('');
  let promptIcon: string = $state(DEFAULT_ICON);
  let promptText: string = $state('');
  let systemPrompt: string = $state('');
  let modelProvider: LLMProvider = $state(DEFAULT_PROVIDER);
  let modelName: string = $state(DEFAULT_MODEL);
  let maxTokens: number | undefined = $state(undefined);
  let temperature: number | undefined = $state(DEFAULT_TEMPERATURE);
  let topP: number | undefined = $state(DEFAULT_TOP_P);

  // fill form fields
  const fillForm = (prompt: Prompt) => {
    promptName = prompt.id;
    promptIcon = prompt.icon || DEFAULT_ICON;
    promptText = prompt.prompt;
    systemPrompt = prompt.systemPrompt || '';
    modelProvider = prompt.provider;
    modelName = prompt.model;
    maxTokens = prompt.maxTokens;
    temperature = prompt.temperature;
    topP = prompt.topP;
  };

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const prompt = prompts.find((p) => p.id === id);
      if (!prompt) {
        return;
      }
      promptId = id;
      fillForm(prompt);
    }
    modal.show();
  };

  // install from external source
  export const install = (prompt: Prompt) => {
    if (modal.isOpen()) {
      return;
    }
    fillForm(prompt);
    modal.show();
  };

  /**
   * Save prompt to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    // validate inputs
    promptName = promptName.trim();
    let prompt = prompts.find((p) => p.id === promptName);
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

    // start saving
    loading.start();
    prompt = prompts.find((p) => p.id === promptId);
    if (prompt) {
      // update prompt
      if (prompt.id !== promptName) {
        prompt.id = promptName;
        updateActionId(PROMPT_MARK, promptId, promptName);
      }
      prompt.icon = promptIcon;
      prompt.prompt = promptText;
      prompt.systemPrompt = systemPrompt;
      prompt.provider = modelProvider;
      prompt.model = modelName;
      prompt.maxTokens = maxTokens;
      prompt.temperature = temperature;
      prompt.topP = topP;
      alert(m.prompt_updated_success());
    } else {
      // add new prompt
      prompts.push({
        id: promptName,
        icon: promptIcon,
        prompt: promptText,
        systemPrompt: systemPrompt,
        provider: modelProvider,
        model: modelName,
        maxTokens: maxTokens,
        temperature: temperature,
        topP: topP
      });
      // reset form
      promptName = '';
      promptIcon = DEFAULT_ICON;
      promptText = '';
      systemPrompt = '';
      modelProvider = DEFAULT_PROVIDER;
      modelName = DEFAULT_MODEL;
      maxTokens = undefined;
      temperature = DEFAULT_TEMPERATURE;
      topP = DEFAULT_TOP_P;
      alert(m.prompt_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal title="{promptId ? m.update() : m.add()}{m.prompt_template()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.action_name()}</Label>
      <div class="flex items-center gap-2">
        <IconSelector bind:icon={promptIcon} />
        <input class="autofocus input input-sm grow" {...schema.name} bind:value={promptName} />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <span>
          <Label required>{m.model_provider()}</Label>
          <Select
            bind:value={modelProvider}
            options={[
              { value: 'ollama', label: 'Ollama' },
              { value: 'lmstudio', label: 'LM Studio' },
              { value: 'openrouter', label: 'OpenRouter', disabled: !openrouterApiKey.current },
              { value: 'openai', label: 'OpenAI', disabled: !openaiApiKey.current },
              { value: 'anthropic', label: 'Anthropic', disabled: !anthropicApiKey.current },
              { value: 'google', label: 'Google', disabled: !geminiApiKey.current },
              { value: 'xai', label: 'xAI', disabled: !xaiApiKey.current }
            ]}
            onchange={(event) => {
              const target = event.currentTarget;
              if (target.value !== 'ollama' && target.value !== 'lmstudio') {
                // reset model name for cloud providers
                modelName = '';
              }
            }}
            class="w-full select-sm"
          />
        </span>
        <span>
          <Label required>{m.model_name()}</Label>
          <label class="input input-sm w-full">
            <CubeIcon class="size-5 opacity-50" />
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
        <input type="checkbox" class="peer" />
        <div class="collapse-title border-b-transparent transition-all duration-200 peer-checked:border-b">
          <SlidersHorizontalIcon class="size-5" />
          {m.more_options()}
        </div>
        <div class="collapse-content space-y-1.5">
          <!-- system prompt -->
          <Label>{m.system_prompt()}</Label>
          <CodeMirror title={m.system_prompt()} language={markdown()} bind:document={systemPrompt} />
          <!-- max tokens -->
          <Label tip={m.max_tokens_tip()}>{m.max_tokens()}</Label>
          <input class="input input-sm w-full" placeholder="0" {...schema.maxTokens} bind:value={maxTokens} />
          <!-- temperature -->
          <Label tip={m.temperature_tip()}>{m.temperature()}</Label>
          <label class="flex items-center gap-4">
            <div class="grow">
              <input class="range w-full text-emphasis range-xs" {...schema.temperature} bind:value={temperature} />
              <div class="mt-2 flex justify-between pl-1 text-xs opacity-70">
                <span>0</span>
                <span>0.5</span>
                <span>1.0</span>
                <span>1.5</span>
                <span>2.0</span>
              </div>
            </div>
            <span class="w-7 text-base font-light tracking-widest">{temperature?.toFixed(1)}</span>
          </label>
          <!-- top p -->
          <Label tip={m.top_p_tip()}>{m.top_p()}</Label>
          <label class="flex items-center gap-4">
            <div class="grow">
              <input class="range w-full text-emphasis range-xs" {...schema.topP} bind:value={topP} />
              <div class="mt-2 flex justify-between pl-1 text-xs opacity-70">
                <span>0</span>
                <span>0.5</span>
                <span>1.0</span>
              </div>
            </div>
            <span class="w-7 text-base font-light tracking-widest">{topP?.toFixed(1)}</span>
          </label>
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
