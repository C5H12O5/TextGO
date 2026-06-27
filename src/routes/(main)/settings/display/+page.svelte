<script lang="ts">
  import { Label, Select, Setting } from '$lib/components';
  import { TOOLBAR_ACTION_COUNT, TOOLBAR_CORNER_RADIUS } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { toolbarCornerRadius, toolbarMaxActions } from '$lib/stores.svelte';
  import { DeviceMobileSpeakerIcon } from 'phosphor-svelte';

  // generate toolbar action count options
  const toolbarActionCountOptions = Array.from(
    { length: TOOLBAR_ACTION_COUNT.max - TOOLBAR_ACTION_COUNT.min + 1 },
    (_, index) => {
      const value = TOOLBAR_ACTION_COUNT.min + index;
      return { value, label: `${value}` };
    }
  );

  const toolbarCornerRadiusMarkCount = 4;
  const toolbarCornerRadiusMarks = Array.from({ length: toolbarCornerRadiusMarkCount }, (_, index) =>
    Math.round(
      TOOLBAR_CORNER_RADIUS.min +
        ((TOOLBAR_CORNER_RADIUS.max - TOOLBAR_CORNER_RADIUS.min) * index) / (toolbarCornerRadiusMarkCount - 1)
    )
  );
</script>

<div class="flex flex-col gap-2">
  <Setting icon={DeviceMobileSpeakerIcon} iconClass="rotate-270" title={m.toolbar_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.max_action_count_explain()} tipPlacement="duplex">{m.max_action_count()}</Label>
      <Select options={toolbarActionCountOptions} bind:value={toolbarMaxActions.current} class="w-24 select-sm" />
    </fieldset>
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.toolbar_corner_radius_explain()} tipPlacement="duplex">{m.toolbar_corner_radius()}</Label>
      <label class="flex max-w-2/5 grow flex-col gap-2 pt-2">
        <input
          class="range w-full text-emphasis range-xs"
          type="range"
          min={TOOLBAR_CORNER_RADIUS.min}
          max={TOOLBAR_CORNER_RADIUS.max}
          step={TOOLBAR_CORNER_RADIUS.step}
          bind:value={toolbarCornerRadius.current}
        />
        <div class="flex justify-between text-xs opacity-70">
          {#each toolbarCornerRadiusMarks as radius (radius)}
            <span>{radius}px</span>
          {/each}
        </div>
      </label>
    </fieldset>
  </Setting>
</div>
