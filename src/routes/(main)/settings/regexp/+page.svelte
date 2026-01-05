<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Button, Icon, List, Regexp, Setting } from '$lib/components';
  import { dumpExtension } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { regexps } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { basename } from '@tauri-apps/api/path';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { PencilSimpleLine, Scroll, Sparkle } from 'phosphor-svelte';

  // regular expression components
  let regexpCreator: Regexp;
  let regexpUpdater: Regexp;

  // handle installation from clipboard
  afterNavigate(async () => {
    if (new URLSearchParams(window.location.search).get('install')) {
      const source = await invoke<string>('get_clipboard_text');
      regexpCreator.install(JSON.parse(source));
    }
  });
</script>

<Setting icon={Scroll} title={m.regexp()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.regexp_count({ count: regexps.current.length })}
    name={m.regexp()}
    hint={m.regexp_hint()}
    bind:data={regexps.current}
    oncreate={() => regexpCreator.showModal()}
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
          regexpCreator.install({
            id: id,
            ...JSON.parse(contents)
          });
        }
      } catch (error) {
        console.error(`Failed to import regexp: ${error}`);
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
        console.error(`Failed to export regexp: ${error}`);
      }
    }}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'Scroll'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        <!-- {#if item.flags}
          <span class="badge badge-ghost badge-sm">
            <span class="opacity-80">/{item.flags}</span>
          </span>
        {/if} -->
      </div>
      <Button
        icon={PencilSimpleLine}
        onclick={(event) => {
          event.stopPropagation();
          regexpUpdater.showModal(item.id);
        }}
      />
    {/snippet}
  </List>
</Setting>

<Regexp bind:this={regexpCreator} regexps={regexps.current} />
<Regexp bind:this={regexpUpdater} regexps={regexps.current} />
