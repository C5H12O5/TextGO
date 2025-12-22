<script lang="ts">
  import { Button, Icon, List, Regexp, Setting } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { regexps } from '$lib/stores.svelte';
  import { PencilSimpleLine, Scroll, Sparkle } from 'phosphor-svelte';

  // regular expression components
  let regexpCreator: Regexp;
  let regexpUpdater: Regexp;
</script>

<Setting icon={Scroll} title={m.regexp()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.regexp_count({ count: regexps.current.length })}
    name={m.regexp()}
    hint={m.regexp_hint()}
    bind:data={regexps.current}
    oncreate={() => regexpCreator.showModal()}
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
