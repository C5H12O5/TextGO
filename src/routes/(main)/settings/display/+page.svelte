<script lang="ts">
  import { Label, Select, Setting } from '$lib/components';
  import { TOOLBAR_ACTION_COUNT } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { toolbarMaxActions } from '$lib/stores.svelte';
  import { DeviceMobileSpeakerIcon } from 'phosphor-svelte';

  // generate toolbar action count options
  const toolbarActionCountOptions = Array.from(
    { length: TOOLBAR_ACTION_COUNT.max - TOOLBAR_ACTION_COUNT.min + 1 },
    (_, index) => {
      const value = TOOLBAR_ACTION_COUNT.min + index;
      return { value, label: `${value}` };
    }
  );
</script>

<div class="flex flex-col gap-2">
  <Setting icon={DeviceMobileSpeakerIcon} iconClass="rotate-270" title={m.toolbar_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label>{m.max_action_count()}</Label>
      <Select options={toolbarActionCountOptions} bind:value={toolbarMaxActions.current} class="w-24 select-sm" />
    </fieldset>
  </Setting>
</div>
