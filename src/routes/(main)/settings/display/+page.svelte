<script lang="ts">
  import { Label, Select, Setting } from '$lib/components';
  import { POPUP_CORNER_RADIUS, TOOLBAR_ACTION_COUNT, TOOLBAR_CORNER_RADIUS } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { popupCornerRadius, toolbarCornerRadius, toolbarMaxActions } from '$lib/stores.svelte';
  import { AppWindowIcon, DeviceMobileSpeakerIcon } from 'phosphor-svelte';

  // generate toolbar action count options
  const toolbarActionCountOptions = Array.from(
    { length: TOOLBAR_ACTION_COUNT.max - TOOLBAR_ACTION_COUNT.min + 1 },
    (_, index) => {
      const value = TOOLBAR_ACTION_COUNT.min + index;
      return { value, label: `${value}` };
    }
  );

  // generate corner radius marks
  const cornerRadiusMarkCount = 4;
  const createCornerRadiusMarks = ({ min, max }: { min: number; max: number }) =>
    Array.from({ length: cornerRadiusMarkCount }, (_, index) =>
      Math.round(min + ((max - min) * index) / (cornerRadiusMarkCount - 1))
    );
  const toolbarCornerRadiusMarks = createCornerRadiusMarks(TOOLBAR_CORNER_RADIUS);
  const popupCornerRadiusMarks = createCornerRadiusMarks(POPUP_CORNER_RADIUS);
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
  <Setting icon={AppWindowIcon} title={m.popup_settings()}>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.popup_corner_radius_explain()} tipPlacement="duplex">{m.popup_corner_radius()}</Label>
      <label class="flex max-w-2/5 grow flex-col gap-2 pt-2">
        <input
          class="range w-full text-emphasis range-xs"
          type="range"
          min={POPUP_CORNER_RADIUS.min}
          max={POPUP_CORNER_RADIUS.max}
          step={POPUP_CORNER_RADIUS.step}
          bind:value={popupCornerRadius.current}
        />
        <div class="flex justify-between text-xs opacity-70">
          {#each popupCornerRadiusMarks as radius (radius)}
            <span>{radius}px</span>
          {/each}
        </div>
      </label>
    </fieldset>
  </Setting>
</div>
