<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import type { Model } from '$lib/types';

  // form schema
  const schema = buildFormSchema(({ text, range }) => ({
    name: text().maxlength(32),
    threshold: range().min(0.01).max(0.99).step(0.01)
  }));

  // default values
  const DEFAULT_ICON = 'Sphere';
  const DEFAULT_THRESHOLD = 0.5;
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { Classifier } from '$lib/classifier';
  import { CodeMirror, IconSelector, Label, Modal, alert } from '$lib/components';
  import { MODEL_MARK } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { updateCaseId } from '$lib/shortcut';
  import { Loading } from '$lib/states.svelte';

  const { models }: { models: Model[] } = $props();
  const loading = new Loading();

  let modelId: string = $state('');
  let modelName: string = $state('');
  let modelIcon: string = $state(DEFAULT_ICON);
  let modelSample: string = $state('');
  let modelThreshold: number = $state(DEFAULT_THRESHOLD);

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (loading.started) {
      alert({ level: 'error', message: m.model_training_waiting() });
      return;
    }
    if (id) {
      const model = models.find((p) => p.id === id);
      if (!model) {
        return;
      }
      modelId = id;
      modelName = model.id;
      modelIcon = model.icon || DEFAULT_ICON;
      modelSample = model.sample;
      modelThreshold = model.threshold;
    }
    modal.show();
  };

  /**
   * Save model information to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    // validate inputs
    modelName = modelName.trim();
    let model = models.find((p) => p.id === modelName);
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

    // start saving
    loading.start();
    model = models.find((c) => c.id === modelId);
    if (model) {
      let retrain = false;
      // update model information
      if (model.id !== modelName) {
        model.id = modelName;
        updateCaseId(MODEL_MARK, modelId, modelName);
        Classifier.clearSavedModel(modelId);
        retrain = true;
      }
      if (model.sample !== modelSample) {
        model.sample = modelSample;
        retrain = true;
      }
      model.icon = modelIcon;
      model.threshold = modelThreshold;
      if (retrain) {
        // retrain model if necessary
        train(modelName);
      } else {
        // only update other info
        alert(m.model_info_updated());
        loading.end();
      }
    } else {
      // train classification model
      models.push({
        id: modelName,
        icon: modelIcon,
        sample: modelSample,
        threshold: modelThreshold
      });
      // train model
      train(modelName, true);
    }
    modal.close();
  }

  /**
   * Train classification model.
   *
   * @param id - model ID
   * @param reset - whether to reset the form
   */
  export async function train(id: string, reset: boolean = false) {
    const model = models.find((c) => c.id === id);
    if (!model) {
      return;
    }
    // mark model as training
    model.modelTrained = undefined;
    try {
      await new Classifier(id).trainModel(model.sample);
      model.modelTrained = true;
      alert(m.model_training_success());
      loading.end();
      // reset form after training
      if (reset) {
        modelName = '';
        modelIcon = DEFAULT_ICON;
        modelSample = '';
        modelThreshold = DEFAULT_THRESHOLD;
      }
    } catch (error) {
      console.error(`Failed to train model: ${error}`);
      model.modelTrained = false;
      alert({ level: 'error', message: m.model_training_failed() });
      loading.end();
    }
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
        <input class="autofocus input input-sm grow" {...schema.name} bind:value={modelName} />
      </div>
      <Label required>{m.positive_samples()}</Label>
      <CodeMirror
        title={m.positive_samples()}
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
