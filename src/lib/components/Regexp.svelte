<script lang="ts">
  import { enhance } from '$app/forms';
  import { Label, Modal, alert } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { m } from '$lib/paraglide/messages';
  import { Loading } from '$lib/states.svelte';
  import type { Regexp } from '$lib/types';
  import { FingerprintSimple, Scroll } from 'phosphor-svelte';

  const { regexps }: { regexps: Regexp[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text }) => ({
    name: text().maxlength(32),
    pattern: text().maxlength(256)
  }));

  let regexpId: string = $state('');
  let regexpName: string = $state('');
  let regexpPattern: string = $state('');

  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const regexp = regexps.find((p) => p.id === id);
      if (regexp) {
        regexpId = id;
        regexpName = regexp.id;
        regexpPattern = regexp.pattern;
      }
    }
    modal.show();
  };

  /**
   * Save regular expression to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    regexpName = regexpName.trim();
    const regexp = regexps.find((p) => p.id === regexpName);
    if (regexp && regexp.id !== regexpId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    loading.start();
    if (regexp) {
      // update regular expression
      regexp.pattern = regexpPattern;
      alert(m.regexp_updated_success());
      loading.end();
    } else {
      // add new regular expression
      regexps.push({
        id: regexpName,
        pattern: regexpPattern
      });
      // reset form
      regexpName = '';
      regexpPattern = '';
      alert(m.regexp_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal icon={Scroll} title="{regexpId ? m.update() : m.add()}{m.regexp()}" bind:this={modal}>
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
        <input class="autofocus grow" {...schema.name} bind:value={regexpName} disabled={!!regexpId} />
      </label>
      <Label required>{m.regexp()}</Label>
      <label class="input w-full">
        <span class="text-xl text-emphasis">/</span>
        <input class="grow" placeholder={m.regexp_placeholder()} {...schema.pattern} bind:value={regexpPattern} />
        <span class="text-xl text-emphasis">/</span>
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
