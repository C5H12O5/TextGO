<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Button, Icon, Label, List, Modal, Prompt, Setting } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { dumpExtension } from '$lib/helpers';
  import { Anthropic, Gemini, LMStudio, Ollama, OpenAI, OpenRouter, XAI } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import {
    anthropicApiKey,
    geminiApiKey,
    lmstudioHost,
    ollamaHost,
    openaiApiKey,
    openrouterApiKey,
    prompts,
    xaiApiKey
  } from '$lib/stores.svelte';
  import type { LLMProvider } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import type { IconComponentProps } from 'phosphor-svelte';
  import { PencilSimpleLineIcon, RobotIcon, SlidersHorizontalIcon, SparkleIcon } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  // mapping of provider icons
  const providerIcons: Record<LLMProvider, Component<IconComponentProps>> = {
    ollama: Ollama,
    lmstudio: LMStudio,
    openrouter: OpenRouter,
    openai: OpenAI,
    anthropic: Anthropic,
    google: Gemini,
    xai: XAI
  };

  // form constraints
  const schema = buildFormSchema(({ text, password }) => ({
    ollamaHost: text().maxlength(256),
    lmstudioHost: text().maxlength(256),
    openrouterApiKey: password().maxlength(256),
    openaiApiKey: password().maxlength(256),
    anthropicApiKey: password().maxlength(256),
    geminiApiKey: password().maxlength(256),
    xaiApiKey: password().maxlength(256)
  }));

  // prompt components
  let promptCreator: Prompt;
  let promptUpdater: Prompt;
  let promptOptions: Modal;

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
    </fieldset>
  </form>
</Modal>
