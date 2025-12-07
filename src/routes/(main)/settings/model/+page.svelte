<script lang="ts">
  import { Classifier } from '$lib/classifier';
  import { Button, Icon, List, Model, Setting } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { models } from '$lib/stores.svelte';
  import { Package, PencilSimpleLine, Sparkle, Sphere, TextT, Warning } from 'phosphor-svelte';

  // classification model
  let modelCreator: Model;
  let modelUpdater: Model;
</script>

<Setting icon={Sphere} title={m.model()} class="min-h-(--app-h)">
  <List
    icon={Sparkle}
    title={m.models_count({ count: models.current.length })}
    name={m.model()}
    hint={m.model_hint()}
    bind:data={models.current}
    oncreate={() => modelCreator.showModal()}
    ondelete={(item) => Classifier.clearSavedModel(item.id)}
  >
    {#snippet row(item)}
      <Icon icon={item.icon || 'Sphere'} class="size-5" />
      <div class="list-col-grow flex items-center gap-4 truncate" title={item.id}>
        <span class="min-w-8 truncate text-base font-light">{item.id}</span>
        {#if item.modelTrained === true}
          {@const { sizeKB, vocabulary } = Classifier.getModelInfo(item.id)}
          <span class="badge badge-ghost badge-sm opacity-80">
            <Package class="size-4 shrink-0" />
            {sizeKB} KB
          </span>
          <span class="badge badge-ghost badge-sm opacity-80">
            <TextT class="size-4 shrink-0" />
            {vocabulary}
            {m.vocabulary()}
          </span>
        {/if}
      </div>
      {#if item.modelTrained === undefined}
        <div class="flex h-8 items-center gap-2 opacity-50">
          <span class="loading loading-sm loading-spinner"></span>
          {m.training()}
        </div>
      {:else if item.modelTrained === false}
        <div class="flex h-8 items-center gap-2 opacity-50">
          <Warning class="size-4 shrink-0" />
          {m.training_failed()}
        </div>
      {:else}
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
