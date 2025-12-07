<script lang="ts">
  import { enhance } from '$app/forms';
  import { Classifier } from '$lib/classifier';
  import { CodeMirror, IconSelector, Label, Modal, alert } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import type { Model } from '$lib/types';

  const { models }: { models: Model[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text, range }) => ({
    name: text().maxlength(32),
    threshold: range().min(0.01).max(0.99).step(0.01)
  }));

  let modelId: string = $state('');
  let modelIcon: string = $state('Sphere');
  let modelName: string = $state('');
  let modelSample: string = $state('');
  let modelThreshold: number = $state(0.5);

  let modal: Modal;
  export const showModal = (id?: string) => {
    if (loading.started) {
      alert({ level: 'error', message: m.model_training_waiting() });
      return;
    }
    if (id) {
      const model = models.find((p) => p.id === id);
      if (model) {
        modelId = id;
        modelName = model.id;
        modelIcon = model.icon || 'Sphere';
        modelSample = model.sample;
        modelThreshold = model.threshold;
      }
    }
    modal.show();
  };

  /**
   * Save model information to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    modelName = modelName.trim();
    const model = models.find((p) => p.id === modelName);
    if (model && model.id !== modelId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    if (!Classifier.validateTrainingData(modelSample)) {
      alert({ level: 'error', message: m.invalid_training_data() });
      return;
    }
    loading.start();
    if (model) {
      // update model information
      model.icon = modelIcon;
      model.threshold = modelThreshold;
      alert(m.model_info_updated());
      loading.end();
    } else {
      // train classification model
      const id = modelName;
      models.push({
        id: id,
        icon: modelIcon,
        sample: modelSample,
        threshold: modelThreshold
      });
      // train model
      const classifier = new Classifier(modelName);
      classifier
        .trainModel(modelSample)
        .then(() => {
          const model = models.find((c) => c.id === id);
          if (model) {
            model.modelTrained = true;
          }
          loading.end();
          alert(m.model_training_success());
          // reset form
          modelIcon = 'Sphere';
          modelName = '';
          modelSample = '';
          modelThreshold = 0.5;
        })
        .catch((error) => {
          console.error(`Failed to train model: ${error}`);
          const model = models.find((c) => c.id === id);
          if (model) {
            model.modelTrained = false;
          }
          loading.end();
          alert({ level: 'error', message: m.model_training_failed() });
        });
    }
    modal.close();
  }
</script>

<Modal title="{modelId ? m.update() : m.add()}{m.model()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.type_name()}</Label>
      <div class="flex items-center gap-2">
        <IconSelector bind:icon={modelIcon} />
        <input class="autofocus input input-sm grow" {...schema.name} bind:value={modelName} disabled={!!modelId} />
      </div>
      <Label required>{m.positive_samples()}</Label>
      <CodeMirror
        title={m.positive_samples()}
        readOnly={!!modelId}
        placeholder={m.positive_samples_placeholder()}
        bind:document={modelSample}
      />
      <Label required tip={m.confidence_threshold_tip()}>{m.confidence_threshold()}</Label>
      <label class="flex w-full items-center gap-4">
        <input class="range grow text-emphasis range-xs" {...schema.threshold} bind:value={modelThreshold} />
        <span class="w-10 text-base font-light tracking-widest">{(modelThreshold * 100).toFixed(0)}%</span>
      </label>
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit" disabled={loading.started}>
        {m.confirm()}
        {#if loading.delayed}
          <span class="loading loading-xs loading-dots"></span>
        {/if}
      </button>
    </div>
  </form>
</Modal>
