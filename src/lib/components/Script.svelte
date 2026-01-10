<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import type { Script, ScriptLang } from '$lib/types';
  import { javascript } from '@codemirror/lang-javascript';
  import { python } from '@codemirror/lang-python';
  import { StreamLanguage } from '@codemirror/language';
  import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
  import { shell } from '@codemirror/legacy-modes/mode/shell';
  import { type } from '@tauri-apps/plugin-os';

  /**
   * JavaScript code template.
   */
  const JAVASCRIPT_TEMPLATE = `
function process(data) {
    // data.clipboard - ${m.clipboard_text()}
    // data.selection - ${m.selected_text()}
    return '';
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

  /**
   * Shell script placeholder.
   */
  const SHELL_PLACEHOLDER = `
\${clipboard} - ${m.clipboard_text()}
\${selection} - ${m.selected_text()}
`.trimStart();

  /**
   * PowerShell script placeholder.
   */
  const POWERSHELL_PLACEHOLDER = `
\${clipboard} - ${m.clipboard_text()}
\${selection} - ${m.selected_text()}
`.trimStart();

  /**
   * Get CodeMirror language package by language type.
   *
   * @param lang - script language type
   * @returns language package and template
   */
  const getLanguage = (lang: ScriptLang) => {
    switch (lang) {
      case 'javascript':
        return {
          package: javascript(),
          template: JAVASCRIPT_TEMPLATE,
          placeholder: ''
        };
      case 'python':
        return {
          package: python(),
          template: PYTHON_TEMPLATE,
          placeholder: ''
        };
      case 'shell':
        return {
          package: StreamLanguage.define(shell),
          template: '',
          placeholder: SHELL_PLACEHOLDER
        };
      case 'powershell':
        return {
          package: StreamLanguage.define(powerShell),
          template: '',
          placeholder: POWERSHELL_PLACEHOLDER
        };
      default:
        return null;
    }
  };

  // operating system type
  const osType = type();

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

  const { scripts }: { scripts: Script[] } = $props();
  const loading = new Loading();

  let scriptId: string = $state('');
  let scriptName: string = $state('');
  let scriptIcon: string = $state(DEFAULT_ICON);
  let scriptLang: ScriptLang = $state(DEFAULT_LANG);
  let scriptText: string = $state(DEFAULT_TMPL);

  // fill form fields
  const fillForm = (script: Script) => {
    scriptName = script.id;
    scriptIcon = script.icon || DEFAULT_ICON;
    scriptLang = script.lang;
    scriptText = script.script;
  };

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const script = scripts.find((s) => s.id === id);
      if (!script) {
        return;
      }
      scriptId = id;
      fillForm(script);
    }
    modal.show();
  };

  // install from external source
  export const install = (script: Script) => {
    if (modal.isOpen()) {
      return;
    }
    fillForm(script);
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
          { value: 'python', label: 'Python' },
          osType === 'windows' ? { value: 'powershell', label: 'PowerShell' } : { value: 'shell', label: 'Shell' }
        ]}
        class="w-full select-sm"
        disabled={!!scriptId}
        onchange={(event) => {
          const target = event.currentTarget;
          const onconfirm = () => {
            scriptLang = target.value as ScriptLang;
            scriptText = getLanguage(scriptLang)?.template || '';
          };
          // determine if current code is template code
          if (scriptText === getLanguage(scriptLang)?.template) {
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
        {@const language = getLanguage(scriptLang)}
        <CodeMirror
          title={m.script()}
          language={language?.package}
          placeholder={language?.placeholder}
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
