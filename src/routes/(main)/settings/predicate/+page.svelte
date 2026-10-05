<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { alert } from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import List from '$lib/components/List.svelte';
  import Predicate from '$lib/components/Predicate.svelte';
  import Setting from '$lib/components/Setting.svelte';
  import { exportExtensions } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { predicates } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile } from '@tauri-apps/plugin-fs';
  import FileJsIcon from 'phosphor-svelte/lib/FileJsIcon';
  import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLineIcon';
  import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';

  let predicateCreator: Predicate;
  let predicateUpdater: Predicate;

  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      await predicates.ready;
      const source = await invoke<string>('get_clipboard_text');
      predicateCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={FileJsIcon} title={m.predicate()} class="min-h-(--app-h)">
  <List
    icon={SparkleIcon}
    title={m.script_count({ count: predicates.current.length })}
    name={m.script()}
    hint={m.predicate_hint()}
    bind:data={predicates.current}
    oncreate={() => predicateCreator.showModal()}
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
          predicateCreator.install({ id, ...JSON.parse(contents) });
        }
      } catch (error) {
        console.error(`Failed to import predicate: ${error}`);
      }
    }}
    onexport={async (items) => {
      try {
        if (await exportExtensions(items)) {
          alert(m.export_success());
        }
      } catch (error) {
        console.error(`Failed to export predicate: ${error}`);
        alert({ level: 'error', message: m.export_failed() });
      }
    }}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'FileJs'} class="size-5" />
      <div class="flex items-center gap-4 truncate list-col-grow" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
      </div>
      <Button
        icon={PencilSimpleLineIcon}
        onclick={(event) => {
          event.stopPropagation();
          predicateUpdater.showModal(item.id);
        }}
      />
    {/snippet}
  </List>
</Setting>

<Predicate bind:this={predicateCreator} predicates={predicates.current} />
<Predicate bind:this={predicateUpdater} predicates={predicates.current} />
