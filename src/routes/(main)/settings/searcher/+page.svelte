<script lang="ts">
  import { Button, Icon, List, Searcher, Setting } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { searchers } from '$lib/stores.svelte';
  import { MagnifyingGlass, PencilSimpleLine, Sparkle } from 'phosphor-svelte';

  // searcher components
  let searcherCreator: Searcher;
  let searcherUpdater: Searcher;
</script>

<Setting icon={MagnifyingGlass} title={m.web_search()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.search_action_count({ count: searchers.current.length })}
    name={m.search_action()}
    hint={m.web_search_hint()}
    bind:data={searchers.current}
    oncreate={() => searcherCreator.showModal()}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'MagnifyingGlass'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
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
