<script lang="ts">
  import { enhance } from '$app/forms';
  import { Classifier } from '$lib/classifier';
  import { CodeMirror, Label, Modal, alert } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import type { Model } from '$lib/types';
  import { FingerprintSimple, Sphere } from 'phosphor-svelte';

  const { models }: { models: Model[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text, range }) => ({
    name: text().maxlength(32),
    threshold: range().min(0.01).max(0.99).step(0.01)
  }));

  let modelId: string = $state('');
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
      model.threshold = modelThreshold;
      alert(m.model_info_updated());
      loading.end();
    } else {
      // train classification model
      const id = modelName;
      models.push({
        id: id,
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

<Modal icon={Sphere} title="{modelId ? m.update() : m.add()}{m.model()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.type_name()}</Label>
      <label class="input w-full">
        <FingerprintSimple class="size-5 opacity-50" />
        <input class="autofocus grow" {...schema.name} bind:value={modelName} disabled={!!modelId} />
      </label>
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
