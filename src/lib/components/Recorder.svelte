<script lang="ts">
  import { Modal } from '$lib/components';
  import { m } from '$lib/paraglide/messages';
  import { type } from '@tauri-apps/plugin-os';
  import { ArrowFatUp, Command, Control, Info, StackPlus, X } from 'phosphor-svelte';

  const osType = type();

  let {
    value = $bindable(''),
    oninput,
    onComplete
  }: {
    value?: string;
    oninput?: (value: string) => void;
    onComplete?: (value: string) => void;
  } = $props();

  // modal
  let modal: Modal;
  export const showModal = () => {
    modal.show();
  };

  // Track pressed keys
  let pressedModifiers = $state<string[]>([]);
  let pressedKey = $state<string>('');
  let isRecording = $state(false);
  let countdown = $state<number | null>(null);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Modifier key mapping
  const MODIFIER_KEYS = {
    Control: 'Ctrl',
    Meta: osType === 'macos' ? 'Command' : 'Meta',
    Alt: osType === 'macos' ? 'Option' : 'Alt',
    Shift: 'Shift'
  };

  // Modifier order for sorting (lower number = higher priority)
  const MODIFIER_ORDER: Record<string, number> = {
    Ctrl: 1,
    Command: 1,
    Meta: 1,
    Alt: 2,
    Option: 2,
    Shift: 3
  };

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
        enter: '⏎',
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

  /**
   * Handle keydown event to capture shortcut
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    const key = event.key;
    const code = event.code; // Use code to get physical key, unaffected by modifiers

    // Handle Escape to cancel
    if (key === 'Escape') {
      clear();
      return;
    }

    // Check if it's a modifier key
    if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
      const modifierName = MODIFIER_KEYS[key as keyof typeof MODIFIER_KEYS];

      // First key must be a modifier
      if (pressedModifiers.length === 0 || pressedModifiers.length < 2) {
        if (!pressedModifiers.includes(modifierName)) {
          pressedModifiers = [...pressedModifiers, modifierName];
        }
      }
      return;
    }

    // Non-modifier key
    // Must have at least one modifier pressed
    if (pressedModifiers.length === 0) {
      return; // Ignore non-modifier keys if no modifiers are pressed
    }

    // Use event.code to get the physical key, unaffected by Shift
    // Normalize key names based on code
    let normalizedKey = '';

    if (code.startsWith('Key')) {
      // Letter keys: KeyA, KeyB, etc. -> A, B, etc.
      normalizedKey = code.substring(3);
    } else if (code.startsWith('Digit')) {
      // Number keys: Digit0, Digit1, etc. -> 0, 1, etc.
      normalizedKey = code.substring(5);
    } else if (code.startsWith('Arrow')) {
      // Arrow keys: ArrowUp, ArrowDown, etc.
      normalizedKey = code;
    } else if (code.startsWith('F') && /^F[0-9]{1,2}$/.test(code)) {
      // Function keys: F1-F12
      normalizedKey = code;
    } else if (
      ['Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Space'].includes(code)
    ) {
      // Special keys
      normalizedKey = code;
    } else {
      // Handle punctuation and other keys based on code
      const codeKeyMap: Record<string, string> = {
        Minus: '-',
        Equal: '=',
        BracketLeft: '[',
        BracketRight: ']',
        Backslash: '\\',
        Semicolon: ';',
        Quote: "'",
        Comma: ',',
        Period: '.',
        Slash: '/',
        Backquote: '`'
      };
      normalizedKey = codeKeyMap[code] || key.toUpperCase();
    }

    pressedKey = normalizedKey;
    buildShortcutString();
  }

  /**
   * Handle keyup event
   */
  function handleKeyUp(event: KeyboardEvent) {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    const key = event.key;

    // Remove released modifier
    if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
      const modifierName = MODIFIER_KEYS[key as keyof typeof MODIFIER_KEYS];
      pressedModifiers = pressedModifiers.filter((m) => m !== modifierName);
    }
  }

  /**
   * Build shortcut string from pressed keys
   */
  function buildShortcutString() {
    if (pressedModifiers.length === 0 || !pressedKey) {
      return;
    }

    // Validate: need at least 1 modifier + 1 key
    if (pressedModifiers.length < 1 || pressedModifiers.length > 2) {
      return;
    }

    // Sort modifiers by fixed order: Ctrl/Command -> Alt/Option -> Shift
    const modifiers = [...pressedModifiers].sort((a, b) => {
      const orderA = MODIFIER_ORDER[a] || 99;
      const orderB = MODIFIER_ORDER[b] || 99;
      return orderA - orderB;
    });

    const shortcutStr = [...modifiers, pressedKey].join('+');

    value = shortcutStr;
    isRecording = false;

    if (oninput) {
      oninput(shortcutStr);
    }

    // Start countdown instead of immediately completing
    startCountdown(shortcutStr);
  }

  /**
   * Start 3-second countdown
   */
  function startCountdown(shortcutStr: string) {
    countdown = 3;

    countdownTimer = setInterval(() => {
      if (countdown !== null && countdown > 1) {
        countdown -= 1;
      } else {
        // Countdown finished
        stopCountdown();
        // Trigger completion callback
        if (onComplete) {
          onComplete(shortcutStr);
        }
        modal.close();
      }
    }, 1000);
  }

  /**
   * Stop countdown
   */
  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdown = null;
  }

  /**
   * Start recording shortcut
   */
  function startRecording() {
    isRecording = true;
    pressedModifiers = [];
    pressedKey = '';
  }

  /**
   * Clear shortcut
   */
  function clear() {
    stopCountdown();
    value = '';
    isRecording = false;
    pressedModifiers = [];
    pressedKey = '';
    if (oninput) {
      oninput('');
    }
  }

  /**
   * Parse shortcut string to display
   */
  function parseShortcut(shortcutStr: string) {
    if (!shortcutStr) return [];
    return shortcutStr.split('+');
  }

  $effect(() => {
    // Auto-start recording when autoStart is true
    if (!isRecording && !value) {
      startRecording();
    }
  });

  $effect(() => {
    // Add global event listeners when recording
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('keyup', handleKeyUp, true);

      return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('keyup', handleKeyUp, true);
      };
    }
  });

  $effect(() => {
    // Cleanup countdown timer on unmount
    return () => {
      stopCountdown();
    };
  });
</script>

<Modal maxWidth="28rem" icon={StackPlus} title={m.register_shortcut()} bind:this={modal}>
  <fieldset class="fieldset">
    <div class="flex flex-col items-center justify-center gap-4 py-4">
      <div class="flex w-full flex-col items-center justify-center gap-2">
        {#if isRecording}
          <div
            class="flex min-w-[200px] items-center justify-center gap-1 rounded-lg border-2 border-primary bg-base-100 px-3 py-2"
          >
            {#if pressedModifiers.length > 0}
              {@const sortedModifiers = [...pressedModifiers].sort((a, b) => {
                const orderA = MODIFIER_ORDER[a] || 99;
                const orderB = MODIFIER_ORDER[b] || 99;
                return orderA - orderB;
              })}
              {#each sortedModifiers as modifier (modifier)}
                {@const display = getKeyDisplay(modifier)}
                <kbd class="kbd kbd-sm">
                  {#if display.type === 'icon'}
                    {@const Icon = display.component}
                    <Icon class="size-4" />
                  {:else}
                    <span class="text-sm">{display.value}</span>
                  {/if}
                </kbd>
                <span class="text-lg font-bold opacity-50">+</span>
              {/each}
            {/if}
            {#if pressedKey}
              <kbd class="kbd kbd-sm">
                <span class="text-sm font-light">{pressedKey}</span>
              </kbd>
            {:else}
              <span class="text-sm opacity-50">{m.recording_keys()}</span>
            {/if}
          </div>
        {:else if countdown !== null}
          <div class="flex items-center gap-2">
            <div
              class="flex min-w-[200px] items-center justify-center gap-1 rounded-lg border-2 border-primary bg-base-100 px-3 py-2"
            >
              {#each parseShortcut(value) as part, index (index)}
                {@const display = getKeyDisplay(part)}
                <kbd class="kbd kbd-sm">
                  {#if display.type === 'icon'}
                    {@const Icon = display.component}
                    <Icon class="size-4" />
                  {:else}
                    <span class="text-sm font-light">{display.value}</span>
                  {/if}
                </kbd>
                {#if index < parseShortcut(value).length - 1}
                  <span class="text-lg font-bold opacity-50">+</span>
                {/if}
              {/each}
            </div>
            <div class="relative flex items-center justify-center">
              <span class="loading loading-sm loading-spinner"></span>
              <span class="absolute font-mono text-xs font-semibold">{countdown}</span>
            </div>
            <button type="button" class="btn btn-circle btn-ghost btn-sm" onclick={clear}>
              <X class="size-4" />
            </button>
          </div>
        {:else if value}
          <div class="flex min-w-[200px] items-center justify-center gap-1">
            {#each parseShortcut(value) as part, index (index)}
              {@const display = getKeyDisplay(part)}
              <kbd class="kbd kbd-sm">
                {#if display.type === 'icon'}
                  {@const Icon = display.component}
                  <Icon class="size-4" />
                {:else}
                  <span class="text-sm font-light">{display.value}</span>
                {/if}
              </kbd>
              {#if index < parseShortcut(value).length - 1}
                <span class="text-lg font-bold opacity-50">+</span>
              {/if}
            {/each}
            <button type="button" class="btn btn-circle btn-ghost btn-sm" onclick={clear}>
              <X class="size-4" />
            </button>
          </div>
        {:else}
          <button type="button" class="btn btn-sm" onclick={startRecording}> Record Shortcut </button>
        {/if}
      </div>
      <div class="flex items-center justify-center gap-1 text-xs tracking-wider opacity-30">
        <Info class="size-4" />
        <span>
          {osType === 'macos'
            ? 'First key must be a modifier (Cmd/Option/Shift/Ctrl), then press any key'
            : 'First key must be a modifier (Ctrl/Alt/Shift), then press any key'}
        </span>
      </div>
    </div>
  </fieldset>
</Modal>
