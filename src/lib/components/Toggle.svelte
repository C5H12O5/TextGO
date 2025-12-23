<script lang="ts" module>
  import type { ChangeEventHandler } from 'svelte/elements';

  export type ToggleProps = Partial<{
    /** Toggle checked value. */
    value: boolean;
    /** Whether to disable toggle. */
    disabled: boolean;
    /** Custom style class name. */
    class: string;
    /** Callback function when toggle value changes. */
    onchange: ChangeEventHandler<HTMLInputElement>;
  }>;
</script>

<script lang="ts">
  let { value = $bindable(false), disabled = false, class: _class, onchange }: ToggleProps = $props();
</script>

<input
  type="checkbox"
  bind:checked={value}
  {disabled}
  {onchange}
  class="toggle checked:border-emphasis checked:bg-emphasis checked:text-white {_class}"
/>
