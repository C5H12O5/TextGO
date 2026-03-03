<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Button, Title, Updater } from '$lib/components';
  import { Extensions, GitHub } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { deLocalizeHref, getLocale } from '$lib/paraglide/runtime';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import {
    ArrowLeftIcon,
    CodeIcon,
    GearIcon,
    GearSixIcon,
    MagnifyingGlassIcon,
    MouseLeftClickIcon,
    RobotIcon,
    ScrollIcon,
    SphereIcon,
    type IconComponentProps
  } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // sidebar width
  const SIDEBAR_WIDTH = '13rem';
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeftIcon}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1 pl-8">
    <GearSixIcon class="size-5 opacity-80" />
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
      {@render menu(SphereIcon, m.model(), resolve('/settings/model'))}
      {@render menu(ScrollIcon, m.regexp(), resolve('/settings/regexp'))}
      <div class="divider my-0 opacity-50"></div>
      <li class="menu-title pl-1 text-xs">{m.custom_actions()}</li>
      {@render menu(RobotIcon, m.ai_conversation(), resolve('/settings/prompt'))}
      {@render menu(CodeIcon, m.script_execution(), resolve('/settings/script'))}
      {@render menu(MagnifyingGlassIcon, m.web_search(), resolve('/settings/searcher'))}
      <div class="divider my-0 opacity-50"></div>
      {@render menu(MouseLeftClickIcon, m.mouse_settings(), resolve('/settings/mouse'))}
      {@render menu(GearIcon, m.general_settings(), resolve('/settings/general'))}
    </ul>
    <Updater />
  </div>
  <div class="overflow-y-auto p-2 pt-0 pr-0" style:margin-left={SIDEBAR_WIDTH}>
    {@render children()}
  </div>
</div>
