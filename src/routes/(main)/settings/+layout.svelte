<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Button, Title } from '$lib/components';
  import { GitHub } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { deLocalizeHref } from '$lib/paraglide/runtime';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import {
    ArrowLeft,
    Code,
    Gear,
    GearSix,
    MagnifyingGlass,
    Robot,
    Scroll,
    Sphere,
    type IconComponentProps
  } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';
  import { onMount } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // sidebar width
  const SIDEBAR_WIDTH = '13rem';

  // app version
  let version = $state('');
  onMount(async () => {
    version = await getVersion();
  });
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeft}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1">
    <GearSix class="size-5 opacity-80" />
    <span class="tracking-wider">{m.settings()}</span>
  </div>
  <button
    class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
    onclick={() => openUrl('https://github.com/C5H12O5/TextGO')}
  >
    <GitHub class="size-5" />
  </button>
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
      <li class="menu-title pl-1 text-xs">{m.custom_recognition()}</li>
      {@render menu(Sphere, m.model(), resolve('/settings/model'))}
      {@render menu(Scroll, m.regexp(), resolve('/settings/regexp'))}
      <div class="divider my-0 opacity-50"></div>
      <li class="menu-title pl-1 text-xs">{m.custom_action()}</li>
      {@render menu(Robot, m.ai_conversation(), resolve('/settings/prompt'))}
      {@render menu(Code, m.script_execution(), resolve('/settings/script'))}
      {@render menu(MagnifyingGlass, m.web_search(), resolve('/settings/searcher'))}
      <div class="divider my-0 opacity-50"></div>
      {@render menu(Gear, m.general_settings(), resolve('/settings/general'))}
    </ul>
    {#if version}
      <div class="mt-auto px-3 py-2 text-xs tracking-wider opacity-30">
        v{version}
      </div>
    {/if}
  </div>
  <div class="overflow-y-auto p-2 pt-0 pr-0" style:margin-left={SIDEBAR_WIDTH}>
    {@render children()}
  </div>
</div>
