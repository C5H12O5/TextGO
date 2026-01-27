<script lang="ts" module>
  import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon, type IconComponentProps } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  export type Message = {
    /** Alert message level. */
    level?: 'info' | 'success' | 'warning' | 'error';
    /** Alert message content. */
    message: string;
    /** Alert display time (milliseconds). */
    timeout?: number;
    /** Whether alert message is unique. */
    unique?: boolean;
  };

  export type AlertProps = {
    /** Whether to display in dialog. */
    dialog?: boolean;
    /** Maximum number of alerts to display. */
    maxSize?: number;
    /** Default alert display time (milliseconds). */
    timeout?: number;
  };

  // current dialog identifier
  let _dialogId: string = $state('');

  // reactive storage for current message
  let message: Message | null = $state(null);

  /**
   * Display alert message.
   *
   * @param msg - alert message instance
   */
  export function alert(msg: Message | string | null) {
    if (typeof msg === 'string') {
      msg = { message: msg };
    }
    message = msg;
  }

  // mapping of alert levels to colors and icons
  const mappings: Record<string, { color: string; icon: Component<IconComponentProps> }> = {
    info: { color: 'var(--color-info)', icon: InfoIcon },
    success: { color: 'var(--color-success)', icon: CheckCircleIcon },
    warning: { color: 'var(--color-warning)', icon: WarningIcon },
    error: { color: 'var(--color-error)', icon: XCircleIcon }
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { fade, fly, slide } from 'svelte/transition';

  const { dialog = false, maxSize = 1, timeout = 2000 }: AlertProps = $props();
  const dialogId = $derived(dialog ? crypto.randomUUID() : '');

  // reactive mapping of alert messages
  const alerts = new SvelteMap<string, Message>();

  // determine whether to display in current component
  let instance = $derived(dialogId === _dialogId ? message : null);
  $effect(() => {
    if (instance) {
      const id = instance.unique ? instance.message : crypto.randomUUID();
      alerts.set(id, instance);
      setTimeout(() => alerts.delete(id), instance.timeout || timeout);
      alert(null);
    }
    return () => {
      if (alerts.size > maxSize) {
        const [id] = alerts.keys();
        alerts.delete(id);
      }
    };
  });

  // update current dialog identifier
  onMount(() => {
    const temp = _dialogId;
    _dialogId = dialogId;
    return () => (_dialogId = temp);
  });
</script>

{#if alerts.size > 0}
  <div class="pointer-events-none toast toast-center toast-top top-14 z-102" in:fly={{ y: -50 }}>
    {#each Array.from(alerts.entries()).reverse() as [id, alert] (id)}
      {@const { icon: Icon, color } = mappings[alert.level ?? 'success']}
      <div
        role="alert"
        class="alert animate-none gap-2 border bg-base-150/95 px-3 py-2 shadow-lg"
        in:slide={{ duration: 100 }}
        out:fade
      >
        <Icon {color} class="size-6" />
        <span>{alert.message}</span>
      </div>
    {/each}
  </div>
{/if}
