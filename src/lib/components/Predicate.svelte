<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import type { Predicate } from '$lib/types';
  import { javascript } from '@codemirror/lang-javascript';

  const schema = buildFormSchema(({ text }) => ({ name: text().maxlength(64) }));
  const DEFAULT_ICON = 'FileJs';
  const TEMPLATE = `
function matches(data) {
    // data.selection - ${m.selected_text()}
    // data.appId - ${m.selection_app_id()}
    return false;
}
`.trimStart();
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert } from '$lib/components/Alert.svelte';
  import CodeMirror from '$lib/components/CodeMirror.svelte';
  import IconSelector from '$lib/components/IconSelector.svelte';
  import Label from '$lib/components/Label.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { PREDICATE_MARK } from '$lib/constants';
  import { updateCaseId } from '$lib/shortcut';

  const { predicates }: { predicates: Predicate[] } = $props();

  let predicateId = $state('');
  let predicateName = $state('');
  let predicateIcon = $state(DEFAULT_ICON);
  let scriptText = $state(TEMPLATE);

  const fillForm = (predicate: Predicate) => {
    predicateName = predicate.id;
    predicateIcon = predicate.icon || DEFAULT_ICON;
    scriptText = predicate.script;
  };

  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const predicate = predicates.find((p) => p.id === id);
      if (!predicate) {
        return;
      }
      predicateId = id;
      fillForm(predicate);
    }
    modal.show();
  };

  export const install = (predicate: Predicate) => {
    if (modal.isOpen()) {
      return;
    }
    fillForm(predicate);
    modal.show();
  };

  /** Save the predicate and keep existing rule references in sync after renaming. */
  function save(form: HTMLFormElement) {
    predicateName = predicateName.trim();
    let predicate = predicates.find((p) => p.id === predicateName);
    if (predicate && predicate.id !== predicateId) {
      alert({ level: 'error', message: m.name_already_used() });
      form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      return;
    }
    if (!scriptText || scriptText.trim().length === 0) {
      alert({ level: 'error', message: m.script_content_empty() });
      return;
    }

    predicate = predicates.find((p) => p.id === predicateId);
    if (predicate) {
      if (predicate.id !== predicateName) {
        predicate.id = predicateName;
        updateCaseId(PREDICATE_MARK, predicateId, predicateName);
      }
      predicate.icon = predicateIcon;
      predicate.script = scriptText;
      alert(m.script_updated_success());
    } else {
      predicates.push({ id: predicateName, icon: predicateIcon, script: scriptText });
      predicateName = '';
      predicateIcon = DEFAULT_ICON;
      scriptText = TEMPLATE;
      alert(m.script_added_success());
    }
    modal.close();
  }
</script>

<Modal title="{predicateId ? m.update() : m.add()}{m.script()}" bind:this={modal}>
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
        <IconSelector bind:icon={predicateIcon} />
        <input class="autofocus input grow input-sm" {...schema.name} bind:value={predicateName} />
      </div>
      <Label required tip={m.predicate_tip()}>{m.script()}</Label>
      <CodeMirror title={m.script()} language={javascript()} bind:document={scriptText} />
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit">{m.confirm()}</button>
    </div>
  </form>
</Modal>
