<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import type { Script, ScriptLang } from '$lib/types';

  /**
   * JavaScript code template.
   */
  const JAVASCRIPT_TEMPLATE = `
function process(data) {
    // data.clipboard - ${m.clipboard_text()}
    // data.selection - ${m.selected_text()}
    return "";
}
`.trimStart();

  /**
   * Python code template.
   */
  const PYTHON_TEMPLATE = `
def process(data):
    # data["clipboard"] - ${m.clipboard_text()}
    # data["selection"] - ${m.selected_text()}
    return ""
`.trimStart();

  // form schema
  const schema = buildFormSchema(({ text }) => ({ name: text().maxlength(64) }));

  // default values
  const DEFAULT_ICON = 'Code';
  const DEFAULT_LANG = 'javascript';
  const DEFAULT_TMPL = JAVASCRIPT_TEMPLATE;
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { CodeMirror, IconSelector, Label, Modal, Select, alert, confirm } from '$lib/components';
  import { SCRIPT_MARK } from '$lib/constants';
  import { updateActionId } from '$lib/shortcut';
  import { Loading } from '$lib/states.svelte';
  import { javascript } from '@codemirror/lang-javascript';
  import { python } from '@codemirror/lang-python';

  const { scripts }: { scripts: Script[] } = $props();
  const loading = new Loading();

  let scriptId: string = $state('');
  let scriptName: string = $state('');
  let scriptIcon: string = $state(DEFAULT_ICON);
  let scriptLang: ScriptLang = $state(DEFAULT_LANG);
  let scriptText: string = $state(DEFAULT_TMPL);

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const script = scripts.find((s) => s.id === id);
      if (script) {
        scriptId = id;
        scriptName = script.id;
        scriptIcon = script.icon || DEFAULT_ICON;
        scriptLang = script.lang;
        scriptText = script.script;
      }
    }
    modal.show();
  };

  /**
   * Save script to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    // validate inputs
    scriptName = scriptName.trim();
    let script = scripts.find((s) => s.id === scriptName);
    if (script && script.id !== scriptId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    if (!scriptText || scriptText.trim().length === 0) {
      alert({ level: 'error', message: m.script_content_empty() });
      return;
    }

    // start saving
    loading.start();
    script = scripts.find((s) => s.id === scriptId);
    if (script) {
      // update script
      if (script.id !== scriptName) {
        script.id = scriptName;
        updateActionId(SCRIPT_MARK, scriptId, scriptName);
      }
      script.icon = scriptIcon;
      script.lang = scriptLang;
      script.script = scriptText;
      alert(m.script_updated_success());
    } else {
      // add new script
      scripts.push({
        id: scriptName,
        icon: scriptIcon,
        lang: scriptLang,
        script: scriptText
      });
      // reset form
      scriptName = '';
      scriptIcon = DEFAULT_ICON;
      scriptLang = DEFAULT_LANG;
      scriptText = DEFAULT_TMPL;
      alert(m.script_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal title="{scriptId ? m.update() : m.add()}{m.script()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.action_name()}</Label>
      <div class="flex items-center gap-2">
        <IconSelector bind:icon={scriptIcon} />
        <input class="autofocus input input-sm grow" {...schema.name} bind:value={scriptName} />
      </div>
      <Label required>{m.script_type()}</Label>
      <Select
        value={scriptLang}
        options={[
          { value: 'javascript', label: 'JavaScript' },
          { value: 'python', label: 'Python' }
        ]}
        class="w-full select-sm"
        disabled={!!scriptId}
        onchange={(event) => {
          const target = event.currentTarget;
          const onconfirm = () => {
            scriptLang = target.value as ScriptLang;
            scriptText = scriptLang === 'python' ? PYTHON_TEMPLATE : JAVASCRIPT_TEMPLATE;
          };
          // determine if current code is template code
          if (scriptText === (scriptLang === 'python' ? PYTHON_TEMPLATE : JAVASCRIPT_TEMPLATE)) {
            // change type directly
            onconfirm();
          } else {
            // confirm to change type
            confirm({
              message: m.change_script_message(),
              oncancel: () => (target.value = scriptLang),
              onconfirm: onconfirm
            });
          }
        }}
      />
      <Label required>{m.script()}</Label>
      {#key scriptLang}
        <CodeMirror
          title={m.script()}
          language={scriptLang === 'python' ? python() : javascript()}
          bind:document={scriptText}
        />
      {/key}
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
