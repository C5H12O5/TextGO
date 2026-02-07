<script lang="ts">
  import { Button, Label, Select, Setting, Toggle } from '$lib/components';
  import { setupTray } from '$lib/helpers';
  import { m } from '$lib/paraglide/messages';
  import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
  import {
    accessibility,
    autoStart,
    historySize,
    longPress,
    longPressDuration,
    minimizeToTray,
    theme
  } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { type } from '@tauri-apps/plugin-os';
  import {
    CheckCircleIcon,
    ClockCounterClockwiseIcon,
    CursorClickIcon,
    MonitorIcon,
    ShieldCheckIcon,
    WarningCircleIcon
  } from 'phosphor-svelte';
  import { onMount } from 'svelte';

  // operating system type
  const osType = type();

  // current language
  let locale: Locale = $state(getLocale());

  /**
   * Toggle auto start status.
   *
   * @param enabled - whether to enable auto start
   */
  async function toggleAutoStart(enabled: boolean) {
    try {
      if (enabled) {
        await enable();
      } else {
        await disable();
      }
      autoStart.current = enabled;
    } catch (error) {
      console.error(`Failed to toggle auto start status: ${error}`);
      // revert the status on error
      autoStart.current = !enabled;
    }
  }

  // check auto start status on mount
  onMount(async () => {
    try {
      autoStart.current = await isEnabled();
      accessibility.current = await invoke<boolean>('check_accessibility');
    } catch (error) {
      console.error(`Failed to check auto start status: ${error}`);
    }
  });
</script>

<div class="flex flex-col gap-2">
  <Setting icon={MonitorIcon} title={m.appearance_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.language_settings()}</Label>
      <Select
        value={locale}
        options={[
          { value: 'en', label: 'English' },
          { value: 'zh-CN', label: '简体中文' }
        ]}
        class="w-36 select-sm"
        onchange={async (event) => {
          const target = event.currentTarget;
          locale = target.value as Locale;
          setLocale(locale);
          await setupTray();
        }}
      />
    </fieldset>
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.theme_settings()}</Label>
      <Select
        options={[
          { value: 'light', label: m.light_theme() },
          { value: 'dark', label: m.dark_theme() },
          { value: 'system', label: m.system_theme() }
        ]}
        bind:value={theme.current}
        class="w-36 select-sm"
      />
    </fieldset>
  </Setting>
  <Setting icon={ClockCounterClockwiseIcon} title={m.history_records()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.history_records_retention()}</Label>
      <Select
        options={[
          { value: 0, label: m.history_none() },
          { value: 3, label: m.history_recent_3() },
          { value: 5, label: m.history_recent_5() },
          { value: 10, label: m.history_recent_10() },
          { value: 20, label: m.history_recent_20() }
        ]}
        bind:value={historySize.current}
        class="w-36 select-sm"
      />
    </fieldset>
  </Setting>
  <Setting icon={CursorClickIcon} title={m.long_press_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.long_press_explain()} tipPlacement="duplex">{m.long_press_enabled()}</Label>
      <Toggle bind:value={longPress.current} />
    </fieldset>
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.long_press_duration()}</Label>
      <label class="flex max-w-2/5 grow flex-col gap-2 pt-2">
        <input
          class="range w-full text-emphasis range-xs"
          type="range"
          min="500"
          max="2000"
          step="100"
          bind:value={longPressDuration.current}
        />
        <div class="flex justify-between text-xs opacity-70">
          <span>0.5s</span>
          <span>1.0s</span>
          <span>1.5s</span>
          <span>2.0s</span>
        </div>
      </label>
    </fieldset>
  </Setting>
  <Setting icon={ShieldCheckIcon} title={m.behavior_settings()}>
    {#if osType === 'macos'}
      <fieldset class="flex items-center justify-between gap-1">
        <Label tip={m.accessibility_explain()} tipPlacement="duplex">{m.accessibility()}</Label>
        {#if accessibility.current}
          <div class="badge bg-base-200 text-emphasis">
            <CheckCircleIcon class="size-4" />
            <span class="text-sm">{m.permission_granted()}</span>
          </div>
        {:else}
          <Button
            icon={WarningCircleIcon}
            text={m.request_permission()}
            square={false}
            class="border-emphasis/30 bg-base-200 text-emphasis"
            onclick={() => invoke('open_accessibility')}
          />
        {/if}
      </fieldset>
      <div class="divider my-0 opacity-60"></div>
    {/if}
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.auto_start()}</Label>
      <Toggle value={autoStart.current} onchange={(event) => toggleAutoStart(event.currentTarget.checked)} />
    </fieldset>
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.minimize_to_tray()}</Label>
      <Toggle bind:value={minimizeToTray.current} />
    </fieldset>
  </Setting>
</div>
