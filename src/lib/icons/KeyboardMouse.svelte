<script lang="ts">
  import type { IconComponentProps } from 'phosphor-svelte';

  const { class: _class }: IconComponentProps = $props();
</script>

<!-- 29 / 16 preserves Phosphor's regular stroke width with the tighter viewBox. -->
<svg
  class={_class}
  xmlns="http://www.w3.org/2000/svg"
  viewBox="1.5 1.5 29 29"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8125"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M18.5 22H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h22a1 1 0 0 1 1 1v1" />
  <path d="M7 12h.01M11 12h.01M15 12h.01M19 12h.01M7 15.5h.01M11 15.5h.01M15 15.5h.01M19 15.5h.01M8 19h9" />
  <rect x="22" y="13" width="7" height="11" rx="2.5" />
  <path d="M25.5 16v2" />
</svg>
