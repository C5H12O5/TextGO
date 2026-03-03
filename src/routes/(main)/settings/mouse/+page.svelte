<script lang="ts">
  import { Label, Setting, Toggle } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { longPress, longPressDuration } from '$lib/stores.svelte';
  import { CursorClickIcon } from 'phosphor-svelte';
</script>

<div class="flex flex-col gap-2">
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
</div>
