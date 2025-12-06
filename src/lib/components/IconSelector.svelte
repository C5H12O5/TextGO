<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert, Icon, Label, Modal } from '$lib/components';
  import { phosphorIcons } from '$lib/components/Icon.svelte';
  import { m } from '$lib/paraglide/messages';
  import { ArrowsLeftRight, Upload } from 'phosphor-svelte';
  import { fly } from 'svelte/transition';

  let { icon = $bindable() }: { icon: string } = $props();

  // modal dialog
  let modal: Modal;

  // search container ref
  let searchContainer: HTMLDivElement;

  // search input
  let searchInput = $state('');

  // selected icon
  let selectedIcon = $state(icon);

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

  async function handleSvgUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // check if file is SVG
    if (!file.name.endsWith('.svg') && !file.type.includes('svg')) {
      alert({ level: 'error', message: '请上传 SVG 格式的文件' });
      input.value = '';
      return;
    }

    try {
      // read file as text
      const text = await file.text();

      // convert to base64 using modern approach
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const base64 = btoa(String.fromCharCode(...data));
      const dataUrl = `data:image/svg+xml;base64,${base64}`;

      // set as selected icon
      selectedIcon = dataUrl;

      // clear file input
      input.value = '';
    } catch (error) {
      console.error('Failed to convert SVG to base64:', error);
      alert({ level: 'error', message: '文件转换失败' });
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

<button
  type="button"
  class="btn h-8"
  onclick={() => {
    searchInput = '';
    selectedIcon = icon;
    modal.show();
  }}
>
  <Icon {icon} class="size-6 opacity-80" />
</button>

<Modal maxWidth="28rem" icon={ArrowsLeftRight} title="更换图标" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ cancel }) => {
      cancel();
      icon = selectedIcon;
      modal.close();
    }}
  >
    <fieldset class="fieldset">
      <!-- icon selection -->
      <Label tip="内置图标库基于 Phosphor Icons">从内置图标库中选择</Label>
      <div class="relative" bind:this={searchContainer}>
        <input
          type="search"
          class="autofocus input input-sm w-full"
          placeholder="搜索图标名称..."
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
                    selectedIcon = iconName;
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
      <Label class="mt-2">或上传自定义 SVG 图标</Label>
      <label class="btn w-full btn-sm">
        <Upload class="size-5" />
        选择 SVG 文件
        <input type="file" accept=".svg,image/svg+xml" class="hidden" onchange={handleSvgUpload} />
      </label>

      <!-- preview -->
      <Label class="mt-6">预览</Label>
      {#key selectedIcon}
        <div
          class="flex items-center justify-center gap-2 truncate rounded-box border bg-base-200 p-2"
          in:fly={{ y: -5, duration: 150 }}
        >
          <Icon icon={selectedIcon} class="size-8" />
          <span class="truncate text-base opacity-80">{selectedIcon}</span>
        </div>
      {/key}
    </fieldset>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal?.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit">{m.confirm()}</button>
    </div>
  </form>
</Modal>
