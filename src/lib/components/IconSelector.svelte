<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert, Icon, Label, Modal } from '$lib/components';
  import { phosphorIcons } from '$lib/components/Icon.svelte';
  import { m } from '$lib/paraglide/messages';
  import { ArrowsLeftRight, Upload } from 'phosphor-svelte';
  import { scale } from 'svelte/transition';

  let { icon: _icon = $bindable() }: { icon: string } = $props();

  // selected icon
  let icon = $state(_icon);

  // search input
  let searchInput = $state('');

  // search container
  let searchContainer: HTMLDivElement;

  // filtered icons based on search input
  let filteredIcons = $derived.by(() => {
    const search = searchInput.trim();
    if (search.length > 0) {
      return Object.keys(phosphorIcons)
        .filter((name) => {
          return name.toLowerCase().includes(search.toLowerCase());
        })
        .splice(0, 99); // limit to 99 results
    }
    return [];
  });

  // modal dialog
  let modal: Modal;
  export const showModal = () => {
    icon = _icon;
    searchInput = '';
    modal.show();
  };

  /**
   * Submit icon selection.
   */
  function submit() {
    _icon = icon;
    searchInput = '';
    modal.close();
  }

  /**
   * Handle SVG file upload.
   *
   * @param event - file input change event
   */
  async function handleSVGUpload(event: Event) {
    // get uploaded file
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    // check if file is SVG
    if (!file.name.endsWith('.svg') && file.type !== 'image/svg+xml') {
      alert({ level: 'error', message: m.invalid_svg_format() });
      input.value = '';
      return;
    }

    try {
      // convert SVG file to base64 data URL
      const data = new TextEncoder().encode(await file.text());
      const base64 = `data:image/svg+xml;base64,${btoa(String.fromCharCode(...data))}`;

      // set as selected icon
      icon = base64;
      input.value = '';
    } catch (error) {
      console.error(`Failed to convert SVG to base64: ${error}`);
      alert({ level: 'error', message: m.svg_convert_failed() });
    }
  }
</script>

<svelte:window
  onclick={(event) => {
    // handle click outside to close dropdown
    const target = event.target as Node;
    if (searchContainer && !searchContainer.contains(target)) {
      searchInput = '';
    }
  }}
/>

<button type="button" class="btn h-8 border" onclick={showModal}>
  <Icon icon={_icon} class="size-6 opacity-80" />
</button>

<Modal maxWidth="28rem" icon={ArrowsLeftRight} title={m.change_icon()} bind:this={modal}>
  <form
    method="post"
    use:enhance={({ cancel }) => {
      cancel();
      submit();
    }}
  >
    <fieldset class="fieldset">
      <!-- icon selection -->
      <Label tip={m.built_in_icons_tip()}>{m.built_in_icons()}</Label>
      <div class="relative" bind:this={searchContainer}>
        <input
          type="search"
          class="autofocus input input-sm w-full"
          placeholder={m.search_icon()}
          bind:value={searchInput}
        />
        {#if filteredIcons.length > 0}
          <div class="absolute z-1 mt-1 max-h-64 w-full overflow-auto rounded-box border bg-base-100 p-2 shadow-lg">
            <div class="grid grid-cols-3 gap-3">
              {#each filteredIcons as iconName (iconName)}
                <button
                  type="button"
                  class="btn h-auto flex-col gap-1 p-1 btn-ghost"
                  onclick={() => {
                    icon = iconName;
                    searchInput = '';
                  }}
                >
                  <Icon icon={iconName} class="size-6" />
                  <span class="w-full truncate text-xs opacity-60">{iconName}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- SVG upload -->
      <Label class="mt-2">{m.upload_svg()}</Label>
      <label class="btn w-full btn-sm">
        <Upload class="size-5" />
        {m.upload_svg_btn()}
        <input type="file" accept=".svg,image/svg+xml" class="hidden" onchange={handleSVGUpload} />
      </label>

      <!-- preview -->
      <Label class="mt-6">{m.preview()}</Label>
      {#key icon}
        <div
          class="flex items-center justify-center gap-2 truncate rounded-box border bg-base-200 p-2"
          in:scale={{ duration: 150 }}
        >
          <Icon {icon} class="size-8" />
          <span class="truncate text-base opacity-80">{icon}</span>
        </div>
      {/key}
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal?.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit">{m.confirm()}</button>
    </div>
  </form>
</Modal>
