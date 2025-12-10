<script lang="ts">
  import { Kbd, Modal } from '$lib/components';
  import { Keyboard } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { Lightbulb, StackPlus } from 'phosphor-svelte';
  import { onMount } from 'svelte';

  const { onrecord }: { onrecord?: (value: string) => void } = $props();

  // modifier keys
  const MODIFIER_KEYS = ['Meta', 'Control', 'Alt', 'Shift'];

  // modal dialog
  let modal: Modal;
  export const showModal = () => {
    startRecording();
    modal.show();
  };

  // recording state
  let recording = $state(false);

  // countdown state
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  // currently pressed keys
  let pressedModifiers = $state<string[]>([]);
  let pressedKey = $state<string>('');

  /**
   * Start the recording process.
   */
  function startRecording() {
    stopRecording();
    // wait a moment to avoid immediate key capture
    setTimeout(() => (recording = true), 200);
  }

  /**
   * Stop the recording without completing.
   */
  function stopRecording() {
    stopCountdown();
    pressedModifiers = [];
    pressedKey = '';
    recording = false;
  }

  /**
   * Complete the recording and invoke callback.
   */
  function completeRecording() {
    stopCountdown();
    // invoke callback
    if (pressedModifiers.length > 0 && pressedKey) {
      onrecord?.([...pressedModifiers, pressedKey].join('+'));
    }
    // close modal
    modal.close();
  }

  /**
   * Sort modifier keys in standard order.
   *
   * @param modifiers - array of modifier keys
   */
  function sortModifiers(modifiers: string[]): string[] {
    return modifiers.sort((a, b) => {
      const orderA = MODIFIER_KEYS.indexOf(a);
      const orderB = MODIFIER_KEYS.indexOf(b);
      return orderA - orderB;
    });
  }

  /**
   * Handle keydown event to capture shortcut.
   *
   * @param event - keyboard event
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (!recording) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const key = event.key;
    const code = event.code;
    console.info(`Key down: key = ${key}, code = ${code}`);

    // check if it's a modifier key
    if (MODIFIER_KEYS.includes(key)) {
      if (pressedModifiers.length < 2 && !pressedModifiers.includes(key)) {
        // sort modifier keys
        pressedModifiers = sortModifiers([...pressedModifiers, key]);
      }
      return;
    } else if (pressedModifiers.length === 0) {
      // ignore non-modifier keys if no modifiers are pressed
      return;
    }

    // use the physical key code for non-modifier keys
    pressedKey = code;

    // start countdown instead of immediately completing
    startCountdown();
  }

  /**
   * Handle keyup event to release modifier keys.
   *
   * @param event - keyboard event
   */
  function handleKeyUp(event: KeyboardEvent) {
    if (!recording) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = event.key;
    if (MODIFIER_KEYS.includes(key)) {
      pressedModifiers = pressedModifiers.filter((m) => m !== key);
    }
  }

  /**
   * Start 500ms countdown to complete recording.
   */
  function startCountdown() {
    recording = false;
    countdownTimer = setInterval(() => {
      completeRecording();
    }, 500);
  }

  /**
   * Stop countdown timer.
   */
  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  onMount(() => {
    // register global key event listeners
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      stopRecording();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  });
</script>

<Modal maxWidth="28rem" icon={StackPlus} title={m.keyboard_shortcut()} bind:this={modal} onclose={stopRecording}>
  <fieldset class="fieldset gap-4 py-4">
    <div class="flex items-center justify-center">
      <div class="flex min-h-10 min-w-40 items-center gap-1 rounded-box border-2 border-primary px-3">
        <!-- pressed modifier keys -->
        {#if pressedModifiers.length > 0}
          {#each pressedModifiers as modifier, index (modifier)}
            <Kbd key={modifier} class={index == 0 && pressedKey ? 'ml-auto' : ''} />
            <span class="text-lg font-bold opacity-50">+</span>
          {/each}
        {:else}
          <Keyboard class="size-6 pr-1 opacity-30" />
        {/if}
        <!-- pressed main key -->
        {#if pressedKey}
          <Kbd key={pressedKey} class="mr-auto" />
        {:else}
          <span class="mx-auto text-sm opacity-50">{m.recording_keys()}</span>
        {/if}
      </div>
    </div>
    <div class="flex items-center justify-center gap-1 opacity-30">
      <Lightbulb class="size-3.5" />
      <span class="text-xs tracking-wider">{m.recording_keys_hint()}</span>
    </div>
  </fieldset>
</Modal>
