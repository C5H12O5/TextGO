<script lang="ts" module>
  import { confirm } from '$lib/components/Confirm.svelte';
  import { m } from '$lib/paraglide/messages';
  import { Channel, invoke } from '@tauri-apps/api/core';
  import { relaunch } from '@tauri-apps/plugin-process';
  import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
  import { check } from '@tauri-apps/plugin-updater';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
  import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDownIcon';
  import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
  import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

  // update checking states
  let versionHovering = $state(false);
  let updateChecking = $state(false);
  let updateStatus = $state('');
  let latestFlag = $state(false);
  let failedFlag = $state(false);

  /**
   * Check for application updates.
   */
  export async function checkForUpdates() {
    if (updateChecking) {
      return;
    }
    updateChecking = true;
    updateStatus = m.checking_for_updates();
    try {
      const update = await check();
      if (!update) {
        // already latest
        latestFlag = true;
        updateStatus = m.already_latest();
        return;
      }
      // confirm update
      versionHovering = false;
      updateChecking = false;
      updateStatus = '';
      confirm({
        icon: SparkleIcon,
        title: m.new_version_available({ version: update.version }),
        message: m.download_and_install(),
        oncancel: () => void update.close(),
        onconfirm: () => downloadAndInstall(update)
      });
    } catch (error) {
      console.error(`Update check failed: ${error}`);
      failedFlag = true;
      updateStatus = m.update_check_failed();
    } finally {
      updateChecking = false;
      if (latestFlag) {
        setTimeout(() => {
          latestFlag = false;
          updateStatus = '';
        }, 3000);
      }
      if (failedFlag) {
        setTimeout(() => {
          failedFlag = false;
          updateStatus = '';
        }, 3000);
      }
    }
  }

  /**
   * Download and install the update.
   *
   * @param update - the update information
   */
  async function downloadAndInstall(update: Update) {
    if (updateChecking || latestFlag) {
      await update.close();
      return;
    }
    updateChecking = true;
    updateStatus = m.download_starting();
    let downloaded = 0;
    let contentLength = 0;
    try {
      const onProgress = (event: DownloadEvent) => {
        switch (event.event) {
          case 'Started':
            downloaded = 0;
            contentLength = event.data.contentLength || 0;
            updateStatus = contentLength
              ? m.download_started({ size: (contentLength / 1024 / 1024).toFixed(2) })
              : m.download_starting();
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            if (contentLength) {
              updateStatus = m.downloading({ progress: ((downloaded / contentLength) * 100).toFixed(1) });
            }
            break;
          }
          case 'Finished':
            updateStatus = m.download_completed();
            break;
        }
      };
      const onEvent = new Channel<DownloadEvent>(onProgress);
      const installed = await invoke<boolean>('try_install_delta', { rid: update.rid, onEvent });
      if (!installed) {
        updateStatus = m.download_starting();
        await update.downloadAndInstall(onProgress);
      }
      // relaunch to apply the update
      latestFlag = true;
      updateStatus = m.relaunch_to_update();
      setTimeout(relaunch, 3000);
    } catch (error) {
      console.error(`Update failed: ${error}`);
      failedFlag = true;
      updateStatus = m.update_failed();
    } finally {
      updateChecking = false;
      await update.close();
      if (failedFlag) {
        setTimeout(() => {
          failedFlag = false;
          updateStatus = '';
        }, 3000);
      }
    }
  }
</script>

<script lang="ts">
  import { getVersion } from '@tauri-apps/api/app';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  // app version
  let version = $state('');
  onMount(async () => {
    version = await getVersion();
  });
</script>

{#if version}
  <button
    class="mx-3 mt-auto mb-2 w-fit text-xs opacity-50 transition-opacity hover:opacity-100 disabled:opacity-50"
    onclick={checkForUpdates}
    disabled={updateChecking || latestFlag || failedFlag}
    onmouseenter={() => (versionHovering = true)}
    onmouseleave={() => (versionHovering = false)}
  >
    {#if updateStatus}
      <div class="flex gap-1">
        {#if latestFlag}
          <CheckCircleIcon class="size-3.5 text-success" />
        {:else if failedFlag}
          <WarningIcon class="size-3.5 text-error" />
        {:else}
          <span class="loading size-3.5 loading-spinner"></span>
        {/if}
        {updateStatus}
      </div>
    {:else if versionHovering}
      <div class="flex cursor-pointer gap-1" in:fade={{ duration: 200 }}>
        <CloudArrowDownIcon class="size-3.5" />{m.check_for_updates()}
      </div>
    {:else}
      <div class="tracking-wider" in:fade={{ duration: 200 }}>v{version}</div>
    {/if}
  </button>
{/if}
