<script lang="ts" module>
  import type { Update } from '@tauri-apps/plugin-updater';
  import type { IconComponentProps } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';

  // update checking states
  let versionHovering = $state(false);
  let updateChecking = $state(false);
  let updateStatus = $state('');
  let latestFlag = $state(false);
  let failedFlag = $state(false);
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Button, Title, confirm } from '$lib/components';
  import { Extensions, GitHub } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { deLocalizeHref, getLocale } from '$lib/paraglide/runtime';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { relaunch } from '@tauri-apps/plugin-process';
  import { check } from '@tauri-apps/plugin-updater';
  import {
    ArrowLeft,
    CheckCircle,
    Code,
    Download,
    Gear,
    GearSix,
    MagnifyingGlass,
    Robot,
    Scroll,
    Sparkle,
    Sphere,
    Warning
  } from 'phosphor-svelte';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  let { children }: { children: Snippet } = $props();

  // sidebar width
  const SIDEBAR_WIDTH = '13rem';

  // app version
  let version = $state('');
  onMount(async () => {
    version = await getVersion();
  });

  /**
   * Check for application updates.
   */
  async function checkForUpdates() {
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
        icon: Sparkle,
        title: m.new_version_available({ version: update.version }),
        message: m.download_and_install(),
        onconfirm: () => downloadAndInstall(update)
      });
    } catch (error) {
      console.error(`Update check failed: ${error}`);
      failedFlag = true;
      updateStatus = m.check_update_failed();
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
    updateChecking = true;
    updateStatus = m.download_starting();
    let downloaded = 0;
    let contentLength = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            updateStatus = m.download_started({ size: (contentLength / 1024 / 1024).toFixed(2) });
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            const progress = contentLength ? ((downloaded / contentLength) * 100).toFixed(1) : '0';
            updateStatus = m.downloading({ progress });
            break;
          }
          case 'Finished':
            updateStatus = m.download_completed();
            break;
        }
      });
      // relaunch to apply the update
      updateStatus = m.relaunch_to_update();
      setTimeout(relaunch, 3000);
    } catch (error) {
      console.error(`Update failed: ${error}`);
      failedFlag = true;
      updateStatus = m.update_failed();
    } finally {
      updateChecking = false;
      if (failedFlag) {
        setTimeout(() => {
          failedFlag = false;
          updateStatus = '';
        }, 3000);
      }
    }
  }
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeft}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1 pl-8">
    <GearSix class="size-5 opacity-80" />
    <span class="tracking-wider">{m.settings()}</span>
  </div>
  <div class="flex items-center gap-2">
    <button
      class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
      onclick={() => {
        const locale = getLocale();
        openUrl(`https://textgo.xylitol.top${locale === 'en' ? '' : `/${locale}`}/extensions.html`);
      }}
    >
      <Extensions class="size-5" />
    </button>
    <button
      class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
      onclick={() => openUrl('https://github.com/C5H12O5/TextGO')}
    >
      <GitHub class="size-5" />
    </button>
  </div>
</Title>

{#snippet menu(icon: Component<IconComponentProps>, text: string, href: string)}
  {@const Icon = icon}
  {@const active = deLocalizeHref(page.url.pathname) === href}
  <li>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a {href} class="gap-2 rounded-field transition-all active:bg-emphasis {active ? 'menu-emphasis' : ''}">
      <Icon class="size-5 opacity-80" />
      <span class="truncate">{text}</span>
    </a>
  </li>
{/snippet}

<div class="h-(--app-h)">
  <div class="fixed top-10.5 bottom-2 flex flex-col overflow-y-auto rounded-container p-0" style:width={SIDEBAR_WIDTH}>
    <ul class="menu w-full gap-1">
      <li class="menu-title pl-1 text-xs">{m.custom_recognitions()}</li>
      {@render menu(Sphere, m.model(), resolve('/settings/model'))}
      {@render menu(Scroll, m.regexp(), resolve('/settings/regexp'))}
      <div class="divider my-0 opacity-50"></div>
      <li class="menu-title pl-1 text-xs">{m.custom_actions()}</li>
      {@render menu(Robot, m.ai_conversation(), resolve('/settings/prompt'))}
      {@render menu(Code, m.script_execution(), resolve('/settings/script'))}
      {@render menu(MagnifyingGlass, m.web_search(), resolve('/settings/searcher'))}
      <div class="divider my-0 opacity-50"></div>
      {@render menu(Gear, m.general_settings(), resolve('/settings/general'))}
    </ul>
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
              <CheckCircle class="size-3.5 text-success" />
            {:else if failedFlag}
              <Warning class="size-3.5 text-error" />
            {:else}
              <span class="loading size-3.5 loading-spinner"></span>
            {/if}
            {updateStatus}
          </div>
        {:else if versionHovering}
          <div class="flex cursor-pointer gap-1" in:fade={{ duration: 200 }}>
            <Download class="size-3.5" />{m.check_for_updates()}
          </div>
        {:else}
          <div class="tracking-wider" in:fade={{ duration: 200 }}>v{version}</div>
        {/if}
      </button>
    {/if}
  </div>
  <div class="overflow-y-auto p-2 pt-0 pr-0" style:margin-left={SIDEBAR_WIDTH}>
    {@render children()}
  </div>
</div>
