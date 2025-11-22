<script lang="ts">
  import { type } from '@tauri-apps/plugin-os';
  import { ArrowFatUp, Command, Control } from 'phosphor-svelte';

  const { key, class: _class }: { key?: string; class?: string } = $props();
  const osType = type();

  /**
   * Parse shortcut string into parts
   */
  function parseShortcut(shortcutStr: string) {
    if (!shortcutStr) return [];
    return shortcutStr.split('+');
  }

  /**
   * Get icon or text for a key part
   */
  function getKeyDisplay(part: string) {
    const normalized = part.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') {
      return { type: 'icon', component: Control };
    } else if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') {
      return { type: 'icon', component: Command };
    } else if (normalized === 'shift') {
      return { type: 'icon', component: ArrowFatUp };
    } else if (normalized === 'alt' || normalized === 'option') {
      return { type: 'text', value: osType === 'macos' ? '⌥' : 'Alt' };
    } else {
      // Display friendly names for special keys
      const keyNameMap: Record<string, string> = {
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→',
        space: 'Space',
        enter: '↵',
        tab: '⇥',
        backspace: '⌫',
        delete: 'Del',
        escape: 'Esc',
        insert: 'Ins',
        home: 'Home',
        end: 'End',
        pageup: 'PgUp',
        pagedown: 'PgDn'
      };
      return { type: 'text', value: keyNameMap[normalized] || part };
    }
  }

  const parts = $derived(key ? parseShortcut(key) : []);
</script>

<div class="flex items-center gap-1 text-primary/80 {_class}">
  {#each parts as part, index}
    {@const display = getKeyDisplay(part)}
    <kbd class="kbd px-1.5 kbd-sm">
      {#if display.type === 'icon'}
        {@const Icon = display.component}
        <Icon class="size-3.5" />
      {:else}
        <div class="text-sm font-light">{display.value}</div>
      {/if}
    </kbd>
    {#if index < parts.length - 1}
      <span class="text-xs opacity-30">+</span>
    {/if}
  {/each}
</div>
