<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Classifier } from '$lib/classifier';
  import { Button, Icon, List, Model, Setting } from '$lib/components';
  import { dumpExtension } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { models } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { ArrowClockwise, Package, PencilSimpleLine, Sparkle, Sphere, Warning } from 'phosphor-svelte';

  // classification model components
  let modelCreator: Model;
  let modelUpdater: Model;

  // handle installation from clipboard
  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      const source = await invoke<string>('get_clipboard_text');
      modelCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={Sphere} title={m.model()} tip={m.experimental()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.model_count({ count: models.current.length })}
    name={m.model()}
    hint={m.model_hint()}
    bind:data={models.current}
    oncreate={() => modelCreator.showModal()}
    ondelete={(item) => Classifier.clearSavedModel(item.id)}
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
          modelCreator.install({
            id: id,
            ...JSON.parse(contents)
          });
        }
      } catch (error) {
        console.error(`Failed to import model: ${error}`);
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
        console.error(`Failed to export model: ${error}`);
      }
    }}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'Sphere'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        <!-- model storage size -->
        {#if item.modelTrained === true}
          {@const { sizeKB } = Classifier.getModelInfo(item.id)}
          <span class="badge badge-ghost badge-sm">
            <Package class="size-4 shrink-0 opacity-80" />
            <span class="opacity-80">{sizeKB} KB</span>
          </span>
        {/if}
      </div>
      {#if item.modelTrained === undefined}
        <!-- model is training -->
        <div class="flex h-8 items-center gap-2 opacity-50">
          <span class="loading loading-sm loading-spinner"></span>
          {m.training()}
        </div>
      {:else if item.modelTrained === false}
        <!-- model training failed -->
        <div class="flex h-8 items-center gap-2 opacity-50">
          <Warning class="size-4 shrink-0" />
          {m.training_failed()}
        </div>
      {:else if Classifier.getModelInfo(item.id).sizeKB === 0}
        <!-- model not trained -->
        <Button
          icon={ArrowClockwise}
          onclick={(event) => {
            event.stopPropagation();
            modelUpdater.train(item.id);
          }}
        />
      {:else}
        <!-- model trained -->
        <Button
          icon={PencilSimpleLine}
          onclick={(event) => {
            event.stopPropagation();
            modelUpdater.showModal(item.id);
          }}
        />
      {/if}
    {/snippet}
  </List>
</Setting>

<Model bind:this={modelCreator} models={models.current} />
<Model bind:this={modelUpdater} models={models.current} />
