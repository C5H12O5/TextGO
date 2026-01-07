<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Button, Icon, List, Searcher, Setting } from '$lib/components';
  import { dumpExtension } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { searchers } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { Globe, MagnifyingGlass, PencilSimpleLine, Sparkle } from 'phosphor-svelte';

  // searcher components
  let searcherCreator: Searcher;
  let searcherUpdater: Searcher;

  // handle installation from clipboard
  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      const source = await invoke<string>('get_clipboard_text');
      searcherCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={MagnifyingGlass} title={m.web_search()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.search_action_count({ count: searchers.current.length })}
    name={m.search_action()}
    hint={m.web_search_hint()}
    bind:data={searchers.current}
    oncreate={() => searcherCreator.showModal()}
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
          searcherCreator.install({
            id: id,
            ...JSON.parse(contents)
          });
        }
      } catch (error) {
        console.error(`Failed to import searcher: ${error}`);
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
        console.error(`Failed to export searcher: ${error}`);
      }
    }}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'MagnifyingGlass'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        {#if item.browser}
          <span class="badge min-w-14 truncate badge-ghost badge-sm" title={item.browser}>
            <Globe class="size-4 shrink-0 opacity-80" />
            <span class="truncate opacity-80">{item.browser}</span>
          </span>
        {/if}
      </div>
      <Button
        icon={PencilSimpleLine}
        onclick={(event) => {
          event.stopPropagation();
          searcherUpdater.showModal(item.id);
        }}
      />
    {/snippet}
  </List>
</Setting>

<Searcher bind:this={searcherCreator} searchers={searchers.current} />
<Searcher bind:this={searcherUpdater} searchers={searchers.current} />
