<script lang="ts" module>
  import { m } from '$lib/paraglide/messages';
  import type { Script } from '$lib/types';

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
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { CodeMirror, Label, Modal, Select, alert, confirm } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { Loading } from '$lib/states.svelte';
  import { javascript } from '@codemirror/lang-javascript';
  import { python } from '@codemirror/lang-python';
  import { ArrowFatLineRight, Code, Empty } from 'phosphor-svelte';

  const { scripts }: { scripts: Script[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text }) => ({ name: text().maxlength(64) }));

  let scriptId: string = $state('');
  let scriptName: string = $state('');
  let scriptLang: 'javascript' | 'python' = $state('javascript');
  let scriptText: string = $state(JAVASCRIPT_TEMPLATE);
  let quietMode: boolean = $state(true);

  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const script = scripts.find((s) => s.id === id);
      if (script) {
        scriptId = id;
        scriptName = script.id;
        scriptLang = script.lang;
        scriptText = script.script;
        quietMode = script.quietMode || false;
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
    scriptName = scriptName.trim();
    const script = scripts.find((s) => s.id === scriptName);
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
    loading.start();
    if (script) {
      // update script
      script.lang = scriptLang;
      script.script = scriptText;
      script.quietMode = quietMode;
      alert(m.script_updated_success());
    } else {
      // add new script
      scripts.push({
        id: scriptName,
        lang: scriptLang,
        script: scriptText,
        quietMode: quietMode
      });
      // reset form
      scriptName = '';
      scriptLang = 'javascript';
      scriptText = JAVASCRIPT_TEMPLATE;
      quietMode = true;
      alert(m.script_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal icon={Code} title="{scriptId ? m.update() : m.add()}{m.script()}" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ formElement, cancel }) => {
      cancel();
      save(formElement);
    }}
  >
    <fieldset class="fieldset">
      <Label required>{m.action_name()}</Label>
      <label class="input w-full">
        <ArrowFatLineRight class="size-5 opacity-50" />
        <input class="autofocus grow" {...schema.name} bind:value={scriptName} disabled={!!scriptId} />
      </label>
      <Label required>{m.script_type()}</Label>
      <Select
        value={scriptLang}
        options={[
          { value: 'javascript', label: 'JavaScript' },
          { value: 'python', label: 'Python' }
        ]}
        class="w-full"
        disabled={!!scriptId}
        onchange={(event) => {
          const target = event.currentTarget;
          const onconfirm = () => {
            scriptLang = target.value as 'javascript' | 'python';
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
      <label class="label mt-2 justify-between rounded-box border px-2 py-1.5">
        <span class="flex items-center gap-2 transition-colors {quietMode ? 'text-base-content' : ''}">
          <Empty class="size-5" />{m.quiet_mode_explain()}
        </span>
        <input type="checkbox" class="checkbox" bind:checked={quietMode} />
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
