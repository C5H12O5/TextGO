<script lang="ts">
  import Label from '$lib/components/Label.svelte';
  import Select from '$lib/components/Select.svelte';
  import Setting from '$lib/components/Setting.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { m } from '$lib/paraglide/messages';
  import { copyKey, forceGetSelection, iBeamCursor, longPress, longPressDuration } from '$lib/stores.svelte';
  import { type } from '@tauri-apps/plugin-os';
  import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
  import CursorTextIcon from 'phosphor-svelte/lib/CursorTextIcon';
  import TextboxIcon from 'phosphor-svelte/lib/TextboxIcon';

  const osType = type();
</script>

<div class="flex flex-col gap-2">
  <Setting icon={TextboxIcon} title={m.text_selection_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.clipboard_fallback_explain()} tipPlacement="duplex">{m.clipboard_fallback()}</Label>
      <Toggle bind:value={forceGetSelection.current} />
    </fieldset>
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.copy_key_explain()} tipPlacement="duplex">{m.copy_key()}</Label>
      {#if osType === 'macos'}
        <Select
          options={[{ value: 'command_c', label: m.command_c() }]}
          bind:value={copyKey.current}
          disabled={!forceGetSelection.current}
          class="w-36 select-sm"
        />
      {:else}
        <Select
          options={[
            { value: 'ctrl_insert', label: m.ctrl_insert() },
            { value: 'ctrl_c', label: m.ctrl_c() }
          ]}
          bind:value={copyKey.current}
          disabled={!forceGetSelection.current}
          class="w-36 select-sm"
        />
      {/if}
    </fieldset>
  </Setting>
  <Setting icon={CursorTextIcon} title={m.cursor_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.ibeam_cursor_explain()} tipPlacement="duplex">{m.ibeam_cursor_enabled()}</Label>
      <Toggle bind:value={iBeamCursor.current} />
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
          disabled={!longPress.current}
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
</div>
