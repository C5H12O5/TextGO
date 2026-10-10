<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert } from '$lib/components/Alert.svelte';
  import Icon, {
    createCustomIconDataURL,
    ICON_EXTENSIONS,
    MAX_ICON_BYTES,
    phosphorIcons
  } from '$lib/components/Icon.svelte';
  import Label from '$lib/components/Label.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { m } from '$lib/paraglide/messages';
  import { open } from '@tauri-apps/plugin-dialog';
  import { readFile, stat } from '@tauri-apps/plugin-fs';
  import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
  import UploadIcon from 'phosphor-svelte/lib/UploadIcon';
  import { onDestroy } from 'svelte';
  import { scale } from 'svelte/transition';

  let { icon: _icon = $bindable() }: { icon: string } = $props();

  // selected icon
  let icon = $state(_icon);
  let uploading = $state(false);
  let uploadRequest = 0;

  /**
   * Cancel pending image uploads and reset the upload state.
   */
  function cancelUpload() {
    uploadRequest++;
    uploading = false;
  }

  onDestroy(cancelUpload);

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
    cancelUpload();
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
   * Handle image file upload.
   */
  async function handleImageUpload() {
    const request = ++uploadRequest;
    uploading = true;
    try {
      // open file dialog to select an image file
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: m.custom_image(), extensions: ICON_EXTENSIONS }]
      });

      if (!path || request !== uploadRequest) {
        return;
      }

      // check file size before reading image contents
      const metadata = await stat(path);
      if (request !== uploadRequest) return;
      if (!metadata.isFile || !metadata.size || metadata.size > MAX_ICON_BYTES) {
        alert({ level: 'error', message: m.image_file_invalid() });
        return;
      }

      // read image file contents
      const contents = await readFile(path);
      if (request !== uploadRequest) return;
      const base64 = createCustomIconDataURL(contents);
      if (!base64) {
        alert({ level: 'error', message: m.image_file_invalid() });
        return;
      }

      // reject corrupt files and formats unsupported by the current WebView
      const image = new Image();
      image.src = base64;
      try {
        await image.decode();
      } catch {
        if (request === uploadRequest) alert({ level: 'error', message: m.image_file_invalid() });
        return;
      }
      // set as selected icon if the upload is still active
      if (request === uploadRequest) icon = base64;
    } catch (error) {
      console.error(`Failed to read custom image: ${error}`);
      if (request === uploadRequest) alert({ level: 'error', message: m.image_read_failed() });
    } finally {
      if (request === uploadRequest) uploading = false;
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

<button type="button" class="btn h-8 border" aria-label={m.change_icon()} onclick={showModal}>
  <Icon icon={_icon} class="size-6 opacity-80" />
</button>

<Modal maxWidth="28rem" icon={ArrowsLeftRightIcon} title={m.change_icon()} onclose={cancelUpload} bind:this={modal}>
  <form
    method="post"
    use:enhance={({ cancel }) => {
      cancel();
      submit();
    }}
  >
    <fieldset class="fieldset" disabled={uploading}>
      <!-- icon selection -->
      <Label tip={m.built_in_icons_tip()}>{m.built_in_icons()}</Label>
      <div class="relative" bind:this={searchContainer}>
        <input
          type="search"
          class="autofocus input w-full input-sm"
          placeholder={m.search_icon()}
          bind:value={searchInput}
        />
        {#if filteredIcons.length > 0}
          <div class="absolute z-1 mt-1 max-h-64 w-full overflow-auto rounded-box border bg-base-100 p-2 shadow-lg">
            <div class="grid grid-cols-3 gap-3">
              {#each filteredIcons as iconName (iconName)}
                <button
                  type="button"
                  class="btn h-auto flex-col gap-1 btn-ghost p-1"
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

      <!-- custom image upload -->
      <Label class="mt-2">{m.upload_image()}</Label>
      <button type="button" class="btn w-full btn-sm" aria-busy={uploading} onclick={handleImageUpload}>
        {#if uploading}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <UploadIcon class="size-5" />
        {/if}
        {m.upload_image_btn()}
      </button>
      <p class="px-1 text-xs opacity-70">{m.upload_image_hint()}</p>

      <!-- preview -->
      <Label class="mt-6">{m.preview()}</Label>
      {#key icon}
        <div
          class="flex items-center justify-center gap-2 truncate rounded-box border bg-base-200 p-2"
          in:scale={{ duration: 150 }}
        >
          <Icon {icon} class="size-8 shrink-0" />
          <span class="truncate text-base opacity-80">{icon.startsWith('data:') ? m.custom_image() : icon}</span>
        </div>
      {/key}
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal?.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit" disabled={uploading}>{m.confirm()}</button>
    </div>
  </form>
</Modal>
