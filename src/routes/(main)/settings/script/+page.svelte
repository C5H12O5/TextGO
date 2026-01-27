<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Button, Icon, Label, List, Modal, Script as ScriptModal, Setting } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { dumpExtension } from '$lib/helpers';
  import { Deno, JavaScript, NodeJS, PowerShell, Python, Shell } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { denoPath, nodePath, pythonPath, scripts } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { CodeIcon, PencilSimpleLineIcon, SlidersHorizontalIcon, SparkleIcon } from 'phosphor-svelte';

  // form constraints
  const schema = buildFormSchema(({ text }) => ({
    nodePath: text().maxlength(256),
    denoPath: text().maxlength(256),
    pythonPath: text().maxlength(256)
  }));

  // script components
  let scriptCreator: ScriptModal;
  let scriptUpdater: ScriptModal;
  let scriptOptions: Modal;

  // handle installation from clipboard
  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      const source = await invoke<string>('get_clipboard_text');
      scriptCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={CodeIcon} title={m.script_execution()} moreOptions={() => scriptOptions.show()} class="min-h-(--app-h)">
  <List
    icon={SparkleIcon}
    title={m.script_count({ count: scripts.current.length })}
    name={m.script()}
    hint={m.script_execution_hint()}
    bind:data={scripts.current}
    oncreate={() => scriptCreator.showModal()}
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
          scriptCreator.install({
            id: id,
            ...JSON.parse(contents)
          });
        }
      } catch (error) {
        console.error(`Failed to import script: ${error}`);
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
        console.error(`Failed to export script: ${error}`);
      }
    }}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'Code'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        <span class="badge badge-ghost badge-sm">
          {#if item.lang === 'javascript'}
            <JavaScript class="h-4 shrink-0" />
            <span class="opacity-80">JavaScript</span>
          {:else if item.lang === 'python'}
            <Python class="h-4 shrink-0" />
            <span class="opacity-80">Python</span>
          {:else if item.lang === 'shell'}
            <Shell class="h-4 shrink-0" />
            <span class="opacity-80">Shell</span>
          {:else if item.lang === 'powershell'}
            <PowerShell class="h-4 shrink-0" />
            <span class="opacity-80">PowerShell</span>
          {/if}
        </span>
      </div>
      <Button
        icon={PencilSimpleLineIcon}
        onclick={(event) => {
          event.stopPropagation();
          scriptUpdater.showModal(item.id);
        }}
      />
    {/snippet}
  </List>
</Setting>

<ScriptModal bind:this={scriptCreator} scripts={scripts.current} />
<ScriptModal bind:this={scriptUpdater} scripts={scripts.current} />

<Modal icon={SlidersHorizontalIcon} title={m.script_options()} bind:this={scriptOptions}>
  <form>
    <fieldset class="fieldset">
      <Label icon={NodeJS}>{m.nodejs_path()}</Label>
      <input
        class="input w-full"
        placeholder={m.nodejs_path_placeholder()}
        {...schema.nodePath}
        bind:value={nodePath.current}
      />
      <Label icon={Deno}>{m.deno_path()}</Label>
      <input
        class="input w-full"
        placeholder={m.deno_path_placeholder()}
        {...schema.denoPath}
        bind:value={denoPath.current}
      />
      <Label icon={Python}>{m.python_path()}</Label>
      <input
        class="input w-full"
        placeholder={m.python_path_placeholder()}
        {...schema.pythonPath}
        bind:value={pythonPath.current}
      />
    </fieldset>
  </form>
</Modal>
