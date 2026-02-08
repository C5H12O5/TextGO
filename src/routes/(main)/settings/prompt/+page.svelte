<script lang="ts">
  import { enhance } from '$app/forms';
  import { afterNavigate } from '$app/navigation';
  import { Button, Icon, Label, List, Modal, Prompt, Setting, alert, confirm } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { dumpExtension } from '$lib/helpers';
  import { Anthropic, Gemini, LMStudio, Ollama, OpenAI, OpenRouter, XAI } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import {
    anthropicApiKey,
    geminiApiKey,
    lmstudioHost,
    ollamaHost,
    openaiApiKey,
    openrouterApiKey,
    prompts,
    providers,
    xaiApiKey
  } from '$lib/stores.svelte';
  import type { CustomLLMProvider, LLMProvider } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import type { IconComponentProps } from 'phosphor-svelte';
  import {
    CubeIcon,
    PencilSimpleLineIcon,
    PlusIcon,
    RobotIcon,
    SlidersHorizontalIcon,
    SparkleIcon,
    TrashIcon
  } from 'phosphor-svelte';
  import type { Component } from 'svelte';
  import { fly } from 'svelte/transition';

  // mapping of provider icons
  const providerIcons: Record<LLMProvider | string, Component<IconComponentProps>> = {
    ollama: Ollama,
    lmstudio: LMStudio,
    openrouter: OpenRouter,
    openai: OpenAI,
    anthropic: Anthropic,
    google: Gemini,
    xai: XAI
  };

  // loading state
  const loading = new Loading();

  // form constraints
  const schema = buildFormSchema(({ text, password }) => ({
    ollamaHost: text().maxlength(256),
    lmstudioHost: text().maxlength(256),
    openrouterApiKey: password().maxlength(256),
    openaiApiKey: password().maxlength(256),
    anthropicApiKey: password().maxlength(256),
    geminiApiKey: password().maxlength(256),
    xaiApiKey: password().maxlength(256),
    // custom provider fields
    name: text().maxlength(64),
    baseUrl: text().maxlength(256),
    apiKey: password().maxlength(256)
  }));

  // custom provider states
  let customProvider: CustomLLMProvider = $state({ name: '', baseUrl: '', apiKey: '' });
  let editingProvider: string | null = $state(null);

  // modal dialog components
  let promptCreator: Prompt;
  let promptUpdater: Prompt;
  let promptOptions: Modal;
  let providerModal: Modal;

  /**
   * Show provider modal dialog for adding or editing.
   *
   * @param provider - provider to edit, or null to add new
   */
  function showProviderModal(provider?: CustomLLMProvider | null) {
    if (provider) {
      editingProvider = provider.name;
      customProvider = { ...provider };
    } else {
      editingProvider = null;
      customProvider = { name: '', baseUrl: '', apiKey: '' };
    }
    providerModal.show();
  }

  /**
   * Save custom provider to persistent storage.
   *
   * @param form - form element
   */
  function saveProvider(form: HTMLFormElement) {
    // validate inputs
    customProvider.name = customProvider.name.trim();
    customProvider.baseUrl = customProvider.baseUrl.trim();
    customProvider.apiKey = customProvider.apiKey.trim();

    const existingProvider = providers.current.find((p) => p.name === customProvider.name);
    if (existingProvider && existingProvider.name !== editingProvider) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    if (!customProvider.name || !customProvider.baseUrl || !customProvider.apiKey) {
      return;
    }

    // start saving
    loading.start();

    if (editingProvider) {
      // update provider
      const index = providers.current.findIndex((p) => p.name === editingProvider);
      if (index !== -1) {
        providers.current[index] = { ...customProvider };
      }
      alert(m.provider_updated_success());
    } else {
      // add new provider
      providers.current = [...providers.current, { ...customProvider }];
      alert(m.provider_added_success());
    }

    // reset form
    providerModal.close();
    editingProvider = null;
    customProvider = { name: '', baseUrl: '', apiKey: '' };
    loading.end();
  }

  // handle installation from clipboard
  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      const source = await invoke<string>('get_clipboard_text');
      promptCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={RobotIcon} title={m.ai_conversation()} moreOptions={() => promptOptions.show()} class="min-h-(--app-h)">
  <List
    icon={SparkleIcon}
    title={m.prompt_template_count({ count: prompts.current.length })}
    name={m.prompt_template()}
    hint={m.ai_conversation_hint()}
    bind:data={prompts.current}
    oncreate={() => promptCreator.showModal()}
    onimport={async () => {
      try {
        const path = await open({
          multiple: false,
          directory: false,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (path) {
          const id = (await basename(path)).replace(/\.json$/i, '');
          const contents = await readTextFile(path);
          promptCreator.install({
            id: id,
            ...JSON.parse(contents)
          });
        }
      } catch (error) {
        console.error(`Failed to import prompt: ${error}`);
      }
    }}
    onexport={async (item) => {
      try {
        const path = await save({
          defaultPath: `${item.id}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (path) {
          await writeTextFile(path, dumpExtension(item));
        }
      } catch (error) {
        console.error(`Failed to export prompt: ${error}`);
      }
    }}
  >
    {#snippet row(item)}
      {@const ProviderIcon = providerIcons[item.provider]}
      <Icon icon={item.icon || 'Robot'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        <span class="badge min-w-14 truncate badge-ghost badge-sm" title={item.model}>
          {#if ProviderIcon}
            <ProviderIcon class="h-4 shrink-0" />
          {:else}
            <CubeIcon class="size-4 shrink-0 opacity-80" />
          {/if}
          <span class="truncate opacity-80">{item.model}</span>
        </span>
      </div>
      <Button
        icon={PencilSimpleLineIcon}
        onclick={(event) => {
          event.stopPropagation();
          promptUpdater.showModal(item.id);
        }}
      />
    {/snippet}
  </List>
</Setting>

<Prompt bind:this={promptCreator} prompts={prompts.current} />
<Prompt bind:this={promptUpdater} prompts={prompts.current} />

<Modal icon={SlidersHorizontalIcon} title={m.ai_options()} bind:this={promptOptions}>
  <form>
    <fieldset class="fieldset">
      <!-- Local LLM Providers -->
      <Label icon={Ollama}>{m.ollama_host()}</Label>
      <input
        class="input w-full"
        placeholder="http://127.0.0.1:11434"
        {...schema.ollamaHost}
        bind:value={ollamaHost.current}
      />
      <Label icon={LMStudio}>{m.lmstudio_host()}</Label>
      <input
        class="input w-full"
        placeholder="http://127.0.0.1:1234"
        {...schema.lmstudioHost}
        bind:value={lmstudioHost.current}
      />
      <!-- Cloud LLM Providers -->
      <div class="divider mb-0 opacity-50">{m.api_keys()}</div>
      <Label icon={OpenRouter}>OpenRouter</Label>
      <input
        class="input w-full"
        placeholder={m.api_key({ provider: 'OpenRouter' })}
        {...schema.openrouterApiKey}
        bind:value={openrouterApiKey.current}
      />
      <Label icon={OpenAI}>OpenAI</Label>
      <input
        class="input w-full"
        placeholder={m.api_key({ provider: 'OpenAI' })}
        {...schema.openaiApiKey}
        bind:value={openaiApiKey.current}
      />
      <Label icon={Anthropic}>Anthropic</Label>
      <input
        class="input w-full"
        placeholder={m.api_key({ provider: 'Anthropic' })}
        {...schema.anthropicApiKey}
        bind:value={anthropicApiKey.current}
      />
      <Label icon={Gemini}>Gemini</Label>
      <input
        class="input w-full"
        placeholder={m.api_key({ provider: 'Gemini' })}
        {...schema.geminiApiKey}
        bind:value={geminiApiKey.current}
      />
      <Label icon={XAI}>xAI</Label>
      <input
        class="input w-full"
        placeholder={m.api_key({ provider: 'xAI' })}
        {...schema.xaiApiKey}
        bind:value={xaiApiKey.current}
      />
      <!-- Custom LLM Providers -->
      <div class="divider mb-0 opacity-50">{m.custom_providers()}</div>
      {#each providers.current as provider (provider.name)}
        <div
          class="mt-1 flex items-center gap-2 truncate rounded-field border bg-base-150 px-3 py-2"
          in:fly={{ x: -15, duration: 150 }}
          out:fly={{ x: 15, duration: 150 }}
        >
          <div class="mr-auto truncate text-base opacity-90">{provider.name}</div>
          <Button icon={PencilSimpleLineIcon} onclick={() => showProviderModal(provider)} />
          <Button
            icon={TrashIcon}
            onclick={() => {
              // confirm delete operation
              confirm({
                title: `${m.delete()}${m.custom_provider()}`,
                message: m.delete_confirm_message(),
                onconfirm: () => {
                  providers.current = providers.current.filter((p) => p.name !== provider.name);
                }
              });
            }}
          />
        </div>
      {/each}
      <Button
        icon={PlusIcon}
        text="{m.add()}{m.custom_provider()}"
        square={false}
        class="mt-2 h-7! w-full font-normal btn-soft"
        onclick={() => showProviderModal()}
      />
    </fieldset>
  </form>
</Modal>

<Modal
  maxWidth="28rem"
  icon={PlusIcon}
  title="{editingProvider ? m.update() : m.add()}{m.custom_provider()}"
  bind:this={providerModal}
>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      saveProvider(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label>{m.provider_name()}</Label>
      <input
        class="autofocus input w-full"
        placeholder={m.provider_name_placeholder()}
        {...schema.name}
        bind:value={customProvider.name}
        disabled={!!editingProvider}
      />
      <Label>{m.base_url()}</Label>
      <input
        class="input w-full"
        placeholder={m.base_url_placeholder()}
        {...schema.baseUrl}
        bind:value={customProvider.baseUrl}
      />
      <Label>{m.api_key({ provider: '' })}</Label>
      <input class="input w-full" placeholder="sk-..." {...schema.apiKey} bind:value={customProvider.apiKey} />
    </fieldset>
    <div class="modal-action">
      <button
        type="button"
        class="btn"
        onclick={() => {
          providerModal.close();
          editingProvider = null;
          customProvider = { name: '', baseUrl: '', apiKey: '' };
        }}
      >
        {m.cancel()}
      </button>
      <button type="submit" class="btn btn-submit" disabled={loading.started}>
        {m.confirm()}
        {#if loading.delayed}
          <span class="loading loading-xs loading-dots"></span>
        {/if}
      </button>
    </div>
  </form>
</Modal>
