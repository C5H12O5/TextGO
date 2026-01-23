<script lang="ts" module>
  import { type as os } from '@tauri-apps/plugin-os';
  import { CheckFat, Globe, MinusCircle, Prohibit, SquaresFour } from 'phosphor-svelte';

  export type BWListProps = {
    /** Type of the list: black or white. */
    type?: 'black' | 'white';
    /** The list of items. */
    list: string[];
  };

  // operating system type
  const osType = os();
</script>

<script lang="ts">
  import { Button, Modal } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { debounce } from 'es-toolkit/function';

  let { type = 'black', list = $bindable([]) }: BWListProps = $props();
  const icon = $derived(type === 'black' ? Prohibit : CheckFat);
  const title = $derived(type === 'black' ? m.blacklist() : m.whitelist());

  // show modal dialog
  let modal: Modal;
  export const showModal = () => {
    modal.show();
  };

  /**
   * Handle input change with debounce.
   *
   * @param index - the index of the item
   * @param value - the input value
   */
  const handleInput = debounce((index: number, value: string) => {
    list[index] = value;
  }, 500);

  /**
   * Handle remove item click.
   *
   * @param index - the index of the item
   */
  function handleRemove(index: number) {
    list = list.filter((_, i) => i !== index);
  }

  /**
   * Add application to the list.
   */
  async function addApplication() {
    try {
      const path = await open({
        defaultPath: osType === 'macos' ? '/Applications' : undefined,
        multiple: false,
        directory: false,
        filters: [{ name: 'Application', extensions: [osType === 'macos' ? 'app' : 'exe'] }]
      });
      if (path) {
        const appId = await invoke<string>('get_app_id', { appPath: path });
        if (appId) {
          list = [...list, appId];
        }
      }
    } catch (error) {
      console.error(`Failed to select app: ${error}`);
    }
  }

  /**
   * Add website to the list.
   */
  function addWebsite() {
    list = [...list, 'https://*'];
  }
</script>

<Modal {icon} {title} bind:this={modal}>
  <div class="flex flex-col gap-3">
    <!-- list items -->
    <div class="flex max-h-96 min-h-18 flex-col justify-center gap-2 overflow-y-auto">
      {#each list as item, index (index)}
        {@const website = item.toLowerCase().startsWith('http://') || item.toLowerCase().startsWith('https://')}
        <div class="flex items-center gap-2">
          <label class="input input-sm w-full">
            {#if website}
              <Globe class="size-5 opacity-30" />
            {:else}
              <SquaresFour class="size-5 opacity-30" />
            {/if}
            <input
              type="search"
              class="grow truncate"
              spellcheck="false"
              value={item}
              oninput={(event) => handleInput(index, event.currentTarget.value)}
              placeholder={m.bwlist_placeholder()}
            />
          </label>
          <Button icon={MinusCircle} size="sm" class="text-error" onclick={() => handleRemove(index)} />
        </div>
      {/each}
      {#if list.length === 0}
        <div class="h-8 text-center text-sm opacity-50">{m.bwlist_empty()}</div>
      {/if}
    </div>
    <!-- action buttons -->
    <div class="flex justify-end gap-2 border-t pt-4">
      <Button
        icon={SquaresFour}
        onclick={addApplication}
        text={type === 'black' ? m.block_app() : m.allow_app()}
        square={false}
        class="btn-soft"
        textClass="font-normal"
      />
      <Button
        icon={Globe}
        onclick={addWebsite}
        text={type === 'black' ? m.block_website() : m.allow_website()}
        square={false}
        class="btn-soft"
        textClass="font-normal"
      />
    </div>
  </div>
</Modal>
