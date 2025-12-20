<script lang="ts" module>
  import { m } from '$lib/paraglide/messages';
  import type { Searcher } from '$lib/types';
  import { type } from '@tauri-apps/plugin-os';

  // operating system type
  const osType = type();

  // browser options based on OS
  const browserOptions =
    osType === 'macos'
      ? [
          { name: 'Chrome', value: 'Google Chrome' },
          { name: 'Edge', value: 'Microsoft Edge' },
          { name: 'Safari', value: 'Safari' },
          { name: 'Firefox', value: 'Firefox' },
          { name: 'Opera', value: 'Opera' }
        ]
      : [
          { name: 'Chrome', value: 'chrome' },
          { name: 'Edge', value: 'msedge' },
          { name: 'Firefox', value: 'firefox' },
          { name: 'Opera', value: 'opera' }
        ];

  /**
   * URL placeholder with variable explanation.
   */
  const URL_PLACEHOLDER = `https://www.google.com/search?q={{selection}}`;
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { IconSelector, Label, Modal, alert } from '$lib/components';
  import { buildFormSchema } from '$lib/constraint';
  import { Loading } from '$lib/states.svelte';
  import { Globe } from 'phosphor-svelte';

  const { searchers }: { searchers: Searcher[] } = $props();
  const loading = new Loading();
  const schema = buildFormSchema(({ text }) => ({
    name: text().maxlength(64),
    browser: text().maxlength(128).required(false),
    url: text().maxlength(512)
  }));

  let searcherId: string = $state('');
  let searcherIcon: string = $state('MagnifyingGlass');
  let searcherName: string = $state('');
  let browser: string = $state('');
  let url: string = $state('');

  let modal: Modal;
  export const showModal = (id?: string) => {
    if (id) {
      const searcher = searchers.find((s) => s.id === id);
      if (searcher) {
        searcherId = id;
        searcherIcon = searcher.icon || 'MagnifyingGlass';
        searcherName = searcher.id;
        browser = searcher.browser || '';
        url = searcher.url;
      }
    }
    modal.show();
  };

  // whether to show browser dropdown
  let showBrowsers: boolean = $state(false);

  // filtered browser options based on input
  let filteredBrowsers = $derived.by(() => {
    const options = [];
    const input = browser.toLowerCase();
    for (const option of browserOptions) {
      if (option.value === browser) {
        return [];
      }
      if (option.name.toLowerCase().includes(input) || option.value.toLowerCase().includes(input)) {
        options.push(option);
      }
    }
    return options;
  });

  /**
   * Save searcher to persistent storage.
   *
   * @param form - form element
   */
  function save(form: HTMLFormElement) {
    searcherName = searcherName.trim();
    const searcher = searchers.find((s) => s.id === searcherName);
    if (searcher && searcher.id !== searcherId) {
      alert({ level: 'error', message: m.name_already_used() });
      const nameInput = form.querySelector('input[name="name"]');
      (nameInput as HTMLInputElement | null)?.focus();
      return;
    }
    url = url.trim();
    if (!url) {
      const urlInput = form.querySelector('textarea[name="url"]');
      (urlInput as HTMLTextAreaElement | null)?.focus();
      return;
    }
    loading.start();
    if (searcher) {
      // update searcher
      searcher.icon = searcherIcon;
      searcher.browser = browser || undefined;
      searcher.url = url;
      alert(m.searcher_updated_success());
    } else {
      // add new searcher
      searchers.push({
        id: searcherName,
        icon: searcherIcon,
        browser: browser || undefined,
        url: url
      });
      // reset form
      searcherIcon = 'MagnifyingGlass';
      searcherName = '';
      browser = '';
      url = '';
      alert(m.searcher_added_success());
    }
    modal.close();
    loading.end();
  }
</script>

<Modal title="{searcherId ? m.update() : m.add()}{m.search_action()}" bind:this={modal}>
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
        <IconSelector bind:icon={searcherIcon} />
        <input
          class="autofocus input input-sm grow"
          {...schema.name}
          bind:value={searcherName}
          disabled={!!searcherId}
        />
      </div>
      <Label>{m.browser()}</Label>
      <div class="relative">
        <label class="input input-sm w-full">
          <Globe class="size-5 opacity-50" />
          <input
            class="grow"
            {...schema.browser}
            bind:value={browser}
            placeholder={m.browser_placeholder()}
            onfocus={() => (showBrowsers = true)}
            onblur={() => setTimeout(() => (showBrowsers = false), 200)}
            autocomplete="off"
          />
        </label>
        {#if showBrowsers && filteredBrowsers.length > 0}
          <ul class="menu absolute z-1 mt-1 max-h-64 w-full overflow-auto rounded-box border bg-base-100 p-2 shadow-lg">
            {#each filteredBrowsers as option (option.value)}
              <li>
                <button
                  type="button"
                  class="flex items-center justify-between"
                  onclick={() => {
                    browser = option.value;
                    showBrowsers = false;
                  }}
                >
                  <span class="text-sm font-medium">{option.name}</span>
                  <span class="text-xs opacity-60">{option.value}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <Label required tip={m.search_url_tip({ selection: '{{selection}}' })}>{m.search_url()}</Label>
      <textarea
        class="textarea w-full font-mono text-sm textarea-sm"
        {...schema.url}
        bind:value={url}
        placeholder={URL_PLACEHOLDER}
        rows="2"
      ></textarea>
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
