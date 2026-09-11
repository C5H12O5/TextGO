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
  import { alert } from '$lib/components/Alert.svelte';
  import CodeMirror from '$lib/components/CodeMirror.svelte';
  import IconSelector from '$lib/components/IconSelector.svelte';
  import Label from '$lib/components/Label.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { MODEL_MARK } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { updateCaseId } from '$lib/shortcut';
  import { onMount, tick } from 'svelte';

  const { models }: { models: Model[] } = $props();
  let training = $state(false);
  let disposed = false;
  let finishPendingPaint: (() => void) | undefined;

  onMount(() => {
    return () => {
      disposed = true;
      // release the rendering wait
      finishPendingPaint?.();
    };
  });

  let modelId: string = $state('');
  let modelName: string = $state('');
  let modelIcon: string = $state(DEFAULT_ICON);
  let modelSample: string = $state('');
  let modelThreshold: number = $state(DEFAULT_THRESHOLD);

  // fill form fields
  const fillForm = (model: Model) => {
    modelName = model.id;
    modelIcon = model.icon || DEFAULT_ICON;
    modelSample = model.sample;
    modelThreshold = model.threshold;
  };

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (training) {
      alert({ level: 'error', message: m.model_training_waiting() });
      return;
    }
    if (id) {
      const model = models.find((p) => p.id === id);
      if (!model) {
        return;
      }
      modelId = id;
      fillForm(model);
    }
    modal.show();
  };

  // install from external source
  export const install = (model: Model) => {
    if (modal.isOpen()) {
      return;
    }
    if (training) {
      alert({ level: 'error', message: m.model_training_waiting() });
      return;
    }
    fillForm(model);
    modal.show();
  };

  /**
   * Save model information to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    if (training) {
      return;
    }
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

    model = models.find((c) => c.id === modelId);
    if (model && model.id !== modelName) {
      try {
        Classifier.renameSavedModel(modelId, modelName);
      } catch (error) {
        console.error(`Failed to rename model: ${error}`);
        alert({ level: 'error', message: m.update_failed() });
        return;
      }
      model.id = modelName;
      updateCaseId(MODEL_MARK, modelId, modelName);
      modelId = modelName;
    }

    // hide the dialog immediately, without leaving its outro over the training status
    form.closest('dialog')?.close();
    modal.close();
    if (model) {
      const retrain = model.sample !== modelSample;
      model.sample = modelSample;
      model.icon = modelIcon;
      model.threshold = modelThreshold;
      if (retrain) {
        // retrain model if necessary
        train(modelName);
      } else {
        // only update other info
        alert(m.model_info_updated());
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
  }

  /**
   * Train classification model.
   *
   * @param id - model ID
   * @param reset - whether to reset the form
   */
  export async function train(id: string, reset: boolean = false) {
    if (training) {
      return;
    }
    const model = models.find((c) => c.id === id);
    if (!model) {
      return;
    }
    // mark model as training
    training = true;
    model.modelTrained = undefined;
    try {
      // tick() updates the DOM; two frames allow it to paint before synchronous TensorFlow setup.
      await tick();
      if (!disposed && document.visibilityState === 'visible') {
        await new Promise<void>((resolve) => {
          let frame: number;
          const finish = () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            finishPendingPaint = undefined;
            resolve();
          };
          const onVisibilityChange = () => {
            // Hidden windows can suspend animation frames indefinitely.
            if (document.visibilityState !== 'visible') finish();
          };
          finishPendingPaint = finish;
          document.addEventListener('visibilitychange', onVisibilityChange);
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(finish);
          });
        });
      }
      await new Classifier(id).trainModel(model.sample);
      model.modelTrained = true;
      alert(m.model_training_success());
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
    } finally {
      training = false;
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
        <input class="autofocus input grow input-sm" {...schema.name} bind:value={modelName} />
      </div>
      <Label required>{m.positive_samples()}</Label>
      <CodeMirror
        title={m.positive_samples()}
        placeholder={m.positive_samples_placeholder()}
        bind:document={modelSample}
      />
      <Label required tip={m.confidence_threshold_tip()}>{m.confidence_threshold()}</Label>
      <label class="flex items-center gap-4">
        <input class="range grow text-emphasis range-xs" {...schema.threshold} bind:value={modelThreshold} />
        <span class="w-10 text-base font-light tracking-widest">{(modelThreshold * 100).toFixed(0)}%</span>
      </label>
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit" disabled={training}>{m.confirm()}</button>
    </div>
  </form>
</Modal>
