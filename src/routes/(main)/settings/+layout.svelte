<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { alert } from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import { confirm } from '$lib/components/Confirm.svelte';
  import Title from '$lib/components/Title.svelte';
  import Updater from '$lib/components/Updater.svelte';
  import { Extensions, GitHub } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { deLocalizeHref, getLocale } from '$lib/paraglide/runtime';
  import { settings as settingsStore } from '$lib/stores.svelte';
  import { getName, getVersion } from '@tauri-apps/api/app';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { type as getOsType } from '@tauri-apps/plugin-os';
  import { relaunch } from '@tauri-apps/plugin-process';
  import type { IconComponentProps } from 'phosphor-svelte';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
  import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
  import DownloadIcon from 'phosphor-svelte/lib/DownloadIcon';
  import GearIcon from 'phosphor-svelte/lib/GearIcon';
  import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
  import MouseLeftClickIcon from 'phosphor-svelte/lib/MouseLeftClickIcon';
  import PaletteIcon from 'phosphor-svelte/lib/PaletteIcon';
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import ScrollIcon from 'phosphor-svelte/lib/ScrollIcon';
  import SphereIcon from 'phosphor-svelte/lib/SphereIcon';
  import UploadIcon from 'phosphor-svelte/lib/UploadIcon';
  import type { Component, Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // sidebar width
  const SIDEBAR_WIDTH = '13rem';

  // configuration transfer
  const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];
  type Settings = Record<string, unknown>;
  type Config = { appVersion: string; osType: string; settings: Settings };

  /**
   * Check whether a value is a non-array object.
   *
   * @param value - value to check
   * @returns whether the value is a non-array object
   */
  function isObject(value: unknown): value is Settings {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Check whether settings contain a non-empty API key.
   *
   * @param settings - settings to inspect
   * @returns whether the exported data contains sensitive information
   */
  function hasSensitiveSettings(settings: Settings): boolean {
    return (
      Object.entries(settings).some(
        ([key, value]) => key.endsWith('ApiKey') && typeof value === 'string' && value.length > 0
      ) ||
      (Array.isArray(settings.providers) &&
        settings.providers.some(
          (provider) => isObject(provider) && typeof provider.apiKey === 'string' && provider.apiKey.length > 0
        ))
    );
  }

  /**
   * Parse and validate exported configuration content.
   *
   * @param contents - JSON configuration file content
   * @returns validated configuration data
   */
  async function parseConfig(contents: string): Promise<Config> {
    const config: unknown = JSON.parse(contents);
    const appName = await getName();
    if (
      !isObject(config) ||
      config.appName !== appName ||
      typeof config.appVersion !== 'string' ||
      typeof config.osType !== 'string' ||
      !isObject(config.settings)
    ) {
      throw new Error('Invalid or unsupported TextGO configuration file.');
    }
    return { appVersion: config.appVersion, osType: config.osType, settings: config.settings };
  }

  /**
   * Replace all persisted settings with the provided data.
   *
   * @param settings - settings to persist
   */
  async function writeSettings(settings: Settings) {
    await settingsStore.clear();
    for (const [key, value] of Object.entries(settings)) {
      await settingsStore.set(key, value);
    }
    await settingsStore.save();
  }

  /**
   * Replace current settings and restore their backup if writing fails.
   *
   * @param settings - settings to import
   */
  async function replaceSettings(settings: Settings) {
    const backup = Object.fromEntries(await settingsStore.entries<unknown>());
    try {
      await writeSettings(settings);
    } catch (error) {
      try {
        await writeSettings(backup);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Failed to import and restore configuration.', {
          cause: rollbackError
        });
      }
      throw error;
    }
  }

  /**
   * Select a destination and export all settings with app metadata.
   *
   * @param settings - settings to export
   */
  async function exportConfig(settings: Settings) {
    try {
      const [appName, appVersion] = await Promise.all([getName(), getVersion()]);
      const osType = getOsType();
      // format local date as YYYYMMDD
      const exportDate = new Intl.DateTimeFormat('sv-SE').format(new Date()).replaceAll('-', '');
      const path = await save({
        defaultPath: `${appName}_${appVersion}_${osType}_${exportDate}.json`,
        filters: JSON_FILTER
      });
      if (!path) {
        return;
      }

      await writeTextFile(path, `${JSON.stringify({ appName, appVersion, osType, settings }, null, 2)}\n`);
      alert(m.export_success());
    } catch (error) {
      console.error('Failed to export configuration:', error);
      alert({ level: 'error', message: m.export_failed() });
    }
  }

  /**
   * Read current settings and request confirmation when they contain API keys.
   */
  async function handleExport() {
    try {
      const settings = Object.fromEntries(await settingsStore.entries<unknown>());
      if (hasSensitiveSettings(settings)) {
        confirm({
          title: m.export_all_settings(),
          message: m.export_sensitive_message(),
          onconfirm: () => void exportConfig(settings)
        });
        return;
      }

      await exportConfig(settings);
    } catch (error) {
      console.error('Failed to read configuration for export:', error);
      alert({ level: 'error', message: m.export_failed() });
    }
  }

  /**
   * Replace current settings and relaunch the app after a successful import.
   *
   * @param settings - validated settings to import
   */
  async function importConfig(settings: Settings) {
    try {
      await replaceSettings(settings);
    } catch (error) {
      console.error('Failed to import configuration:', error);
      alert({
        level: 'error',
        message: error instanceof AggregateError ? m.import_restore_failed() : m.import_failed()
      });
      return;
    }

    try {
      await relaunch();
    } catch (error) {
      console.error('Failed to relaunch after importing configuration:', error);
      alert({ level: 'error', message: m.import_restart_failed(), timeout: 5000 });
    }
  }

  /**
   * Select, validate, and confirm a configuration file for import.
   */
  async function handleImport() {
    let contents: string;
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: JSON_FILTER
      });
      if (!path) {
        return;
      }
      contents = await readTextFile(path);
    } catch (error) {
      console.error('Failed to read configuration file:', error);
      alert({ level: 'error', message: m.import_failed() });
      return;
    }

    let config: Config;
    try {
      config = await parseConfig(contents);
    } catch (error) {
      console.error('Invalid configuration file:', error);
      alert({ level: 'error', message: m.import_file_invalid() });
      return;
    }

    confirm({
      title: `${m.import_all_settings()} [${config.osType}/v${config.appVersion}]`,
      message: m.import_overwrite_message(),
      onconfirm: () => void importConfig(config.settings)
    });
  }
</script>

<Title>
  <Button
    size="md"
    icon={ArrowLeftIcon}
    class="border-none gradient bg-base-300"
    onclick={() => goto(resolve('/shortcuts'))}
  />
  <div class="pointer-events-none mx-auto flex items-center gap-1 pl-28.75">
    <GearSixIcon class="size-5 opacity-80" />
    <span class="tracking-wider">{m.settings()}</span>
  </div>
  <div class="flex items-center gap-2">
    <Button
      size="sm"
      icon={UploadIcon}
      iconClass="opacity-80"
      text={m.export_all_settings()}
      onclick={() => handleExport()}
    />
    <Button
      size="sm"
      icon={DownloadIcon}
      iconClass="opacity-80"
      text={m.import_all_settings()}
      onclick={() => handleImport()}
    />
    <div class="divider mx-0 my-auto divider-horizontal h-5 w-2 opacity-50"></div>
    <button
      class="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
      onclick={() => {
        const locale = getLocale();
        openUrl(`https://textgo.xylitol.top${locale === 'en' ? '' : `/${locale}`}/extensions`);
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
    <a {href} class="gap-2 rounded-field transition-colors active:bg-emphasis {active ? 'menu-emphasis' : ''}">
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
      {@render menu(PaletteIcon, m.display_settings(), resolve('/settings/display'))}
      {@render menu(MouseLeftClickIcon, m.mouse_settings(), resolve('/settings/mouse'))}
      {@render menu(GearIcon, m.general_settings(), resolve('/settings/general'))}
    </ul>
    <Updater />
  </div>
  <div class="overflow-y-auto p-2 pt-0 pr-0" style:margin-left={SIDEBAR_WIDTH}>
    {@render children()}
  </div>
</div>
