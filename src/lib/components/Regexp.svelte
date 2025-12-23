<script lang="ts" module>
  import { buildFormSchema } from '$lib/constraint';
  import type { Regexp } from '$lib/types';

  // form schema
  const schema = buildFormSchema(({ text }) => ({
    name: text().maxlength(32),
    pattern: text().maxlength(256)
  }));

  // default values
  const DEFAULT_ICON = 'Scroll';
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { IconSelector, Label, Modal, alert } from '$lib/components';
  import { REGEXP_MARK } from '$lib/constants';
  import { tooltip } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { updateCaseId } from '$lib/shortcut';
  import { Loading } from '$lib/states.svelte';

  const { regexps }: { regexps: Regexp[] } = $props();
  const loading = new Loading();

  let regexpId: string = $state('');
  let regexpName: string = $state('');
  let regexpIcon: string = $state(DEFAULT_ICON);
  let regexpPattern: string = $state('');
  let flagI: boolean = $state(false);
  let flagU: boolean = $state(false);
  let flagM: boolean = $state(false);
  let flagS: boolean = $state(false);

  // show modal dialog
  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const regexp = regexps.find((p) => p.id === id);
      if (!regexp) {
        return;
      }
      regexpId = id;
      regexpName = regexp.id;
      regexpIcon = regexp.icon || DEFAULT_ICON;
      regexpPattern = regexp.pattern;
      const flags = regexp.flags || '';
      flagI = flags.includes('i');
      flagU = flags.includes('u');
      flagM = flags.includes('m');
      flagS = flags.includes('s');
    }
    modal.show();
  };

  /**
   * Save regular expression to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    // validate inputs
    regexpName = regexpName.trim();
    let regexp = regexps.find((p) => p.id === regexpName);
    if (regexp && regexp.id !== regexpId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }

    // start saving
    loading.start();
    regexp = regexps.find((p) => p.id === regexpId);
    const flags = [flagI && 'i', flagU && 'u', flagM && 'm', flagS && 's'].filter(Boolean).join('');
    if (regexp) {
      // update regular expression
      if (regexp.id !== regexpName) {
        regexp.id = regexpName;
        updateCaseId(REGEXP_MARK, regexpId, regexpName);
      }
      regexp.icon = regexpIcon;
      regexp.pattern = regexpPattern;
      regexp.flags = flags;
      alert(m.regexp_updated_success());
      loading.end();
    } else {
      // add new regular expression
      regexps.push({
        id: regexpName,
        icon: regexpIcon,
        pattern: regexpPattern,
        flags: flags
      });
      // reset form
      regexpName = '';
      regexpIcon = DEFAULT_ICON;
      regexpPattern = '';
      flagI = flagU = flagM = flagS = false;
      alert(m.regexp_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal title="{regexpId ? m.update() : m.add()}{m.regexp()}" bind:this={modal}>
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
        <IconSelector bind:icon={regexpIcon} />
        <input class="autofocus input input-sm grow" {...schema.name} bind:value={regexpName} />
      </div>
      <Label required>{m.regexp()}</Label>
      <label class="input input-sm w-full">
        <span class="text-xl text-emphasis/50">/</span>
        <input class="grow" placeholder={m.regexp_placeholder()} {...schema.pattern} bind:value={regexpPattern} />
        <span class="text-xl text-emphasis/50">/</span>
      </label>
      <!-- regular expression flags -->
      <div class="mt-2 grid grid-cols-4 gap-1">
        <label class="label justify-center" use:tooltip={{ content: m.regexp_flag_i_tip(), followCursor: true }}>
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={flagI} />
          <span class="text-sm {flagI ? 'text-base-content' : ''}">{m.regexp_flag_i()}</span>
        </label>
        <label class="label justify-center" use:tooltip={{ content: m.regexp_flag_u_tip(), followCursor: true }}>
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={flagU} />
          <span class="text-sm {flagU ? 'text-base-content' : ''}">{m.regexp_flag_u()}</span>
        </label>
        <label class="label justify-center" use:tooltip={{ content: m.regexp_flag_m_tip(), followCursor: true }}>
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={flagM} />
          <span class="text-sm {flagM ? 'text-base-content' : ''}">{m.regexp_flag_m()}</span>
        </label>
        <label class="label justify-center" use:tooltip={{ content: m.regexp_flag_s_tip(), followCursor: true }}>
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={flagS} />
          <span class="text-sm {flagS ? 'text-base-content' : ''}">{m.regexp_flag_s()}</span>
        </label>
      </div>
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
