<script lang="ts">
  import { Button, Icon, Label, List, Modal, Script as ScriptModal, Setting } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { JavaScript, Python } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { nodePath, pythonPath, scripts } from '$lib/stores.svelte';
  import { Code, PencilSimpleLine, SlidersHorizontal, Sparkle } from 'phosphor-svelte';

  // form constraints
  const schema = buildFormSchema(({ text }) => ({
    nodePath: text().maxlength(256),
    pythonPath: text().maxlength(256)
  }));

  // script components
  let scriptCreator: ScriptModal;
  let scriptUpdater: ScriptModal;
  let scriptOptions: Modal;
</script>

<Setting icon={Code} title={m.script_execution()} moreOptions={() => scriptOptions.show()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.script_count({ count: scripts.current.length })}
    name={m.script()}
    hint={m.script_execution_hint()}
    bind:data={scripts.current}
    oncreate={() => scriptCreator.showModal()}
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
          {/if}
        </span>
      </div>
      <Button
        icon={PencilSimpleLine}
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

<Modal icon={SlidersHorizontal} title={m.script_options()} bind:this={scriptOptions}>
  <form>
    <fieldset class="fieldset">
      <Label>{m.nodejs_path()}</Label>
      <input
        class="input w-full"
        placeholder={m.nodejs_path_placeholder()}
        {...schema.nodePath}
        bind:value={nodePath.current}
      />
      <Label>{m.python_path()}</Label>
      <input
        class="input w-full"
        placeholder={m.python_path_placeholder()}
        {...schema.pythonPath}
        bind:value={pythonPath.current}
      />
    </fieldset>
  </form>
</Modal>
