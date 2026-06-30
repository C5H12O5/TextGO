<script lang="ts">
  import Label from '$lib/components/Label.svelte';
  import Select from '$lib/components/Select.svelte';
  import Setting from '$lib/components/Setting.svelte';
  import { POPUP_CORNER_RADIUS, TOOLBAR_ACTION_COUNT, TOOLBAR_CORNER_RADIUS, TOOLBAR_OPACITY } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { popupCornerRadius, toolbarCornerRadius, toolbarMaxActions, toolbarOpacity } from '$lib/stores.svelte';
  import { AppWindowIcon, DeviceMobileSpeakerIcon } from 'phosphor-svelte';

  // generate toolbar action count options
  const toolbarActionCountOptions = Array.from(
    { length: TOOLBAR_ACTION_COUNT.max - TOOLBAR_ACTION_COUNT.min + 1 },
    (_, index) => {
      const value = TOOLBAR_ACTION_COUNT.min + index;
      return { value, label: `${value}` };
    }
  );

  // generate range marks
  const createRangeMarks = ({ min, max }: { min: number; max: number }, count: number) =>
    Array.from({ length: count }, (_, index) => Math.round(min + ((max - min) * index) / (count - 1)));
  const toolbarCornerRadiusMarks = createRangeMarks(TOOLBAR_CORNER_RADIUS, 4);
  const popupCornerRadiusMarks = createRangeMarks(POPUP_CORNER_RADIUS, 4);
  const toolbarOpacityMarks = createRangeMarks(TOOLBAR_OPACITY, 3);
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
    <div class="divider my-0 opacity-60"></div>
    <fieldset class="flex items-center justify-between gap-1">
      <Label tip={m.toolbar_opacity_explain()} tipPlacement="duplex">{m.toolbar_opacity()}</Label>
      <label class="flex max-w-2/5 grow flex-col gap-2 pt-2">
        <input
          class="range w-full text-emphasis range-xs"
          type="range"
          min={TOOLBAR_OPACITY.min}
          max={TOOLBAR_OPACITY.max}
          step={TOOLBAR_OPACITY.step}
          bind:value={toolbarOpacity.current}
        />
        <div class="flex justify-between text-xs opacity-70">
          {#each toolbarOpacityMarks as opacity (opacity)}
            <span>{opacity}%</span>
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
