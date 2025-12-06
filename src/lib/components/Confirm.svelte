<script lang="ts" module>
  import { m } from '$lib/paraglide/messages';
  import { escape } from 'es-toolkit/string';
  import { Warning, X, type IconComponentProps } from 'phosphor-svelte';
  import { tick, type Component } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';

  export type Message = Partial<{
    /** Confirm message icon. */
    icon: Component<IconComponentProps>;
    /** Confirm message title. */
    title: string;
    /** Confirm message content. */
    message: string;
    /** Callback function when canceling. */
    oncancel: () => void;
    /** Callback function when confirming. */
    onconfirm: () => void;
  }>;

  // reactive mapping of confirm messages
  export const messages = new SvelteMap<string, Message>();

  /**
   * Display confirm message dialog.
   *
   * @param msg - confirm message instance
   */
  export function confirm(msg: Message) {
    const id = `msg-${crypto.randomUUID()}`;
    messages.set(id, msg);
    // wait for dialog to be added to DOM
    tick().then(() => {
      const dialog = document.getElementById(id) as HTMLDialogElement | null;
      if (!dialog) {
        return;
      }
      dialog.showModal();
    });
  }

  /**
   * Close confirm message dialog.
   *
   * @param id - ID of the message dialog
   * @param callback - callback function to call before closing
   * @param event - mouse event that triggered the close operation
   */
  function close(id: string, callback?: () => void, event: MouseEvent | null = null) {
    if (event) {
      event.preventDefault();
    }
    let msg = messages.get(id);
    if (msg) {
      callback?.();
      messages.delete(id);
    }
  }

  /**
   * Convert part of the title to special format.
   *
   * @param title - title string
   * @return formatted HTML string
   */
  function pretty(title: string): string {
    title = escape(title);
    return title.replace(/\[([^\]]+)\]/g, '<span class="truncate font-normal font-kbd opacity-60">$1</span>');
  }
</script>

{#each messages.entries() as [id, msg] (id)}
  {@const Icon = msg.icon || Warning}
  <dialog {id} class="modal transition-none" transition:fade={{ duration: 200 }}>
    <form method="dialog" class="modal-backdrop">
      <button onclick={(event) => close(id, msg.oncancel, event)} aria-label="Close"></button>
    </form>
    <div class="modal-box max-w-xl">
      <form method="dialog" class="modal-corner">
        <button onclick={(event) => close(id, msg.oncancel, event)}><X /></button>
      </form>
      <!-- message title -->
      <h3 class="modal-title">
        <Icon class="size-6" />
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html pretty(msg.title || m.default_confirm_title())}
      </h3>
      <!-- message content -->
      <p class="opacity-90">
        {msg.message || m.default_confirm_message()}
      </p>
      <!-- action buttons -->
      <div class="modal-action">
        <button class="btn" onclick={() => close(id, msg.oncancel)}>{m.cancel()}</button>
        <button class="btn btn-submit" onclick={() => close(id, msg.onconfirm)}>{m.confirm()}</button>
      </div>
    </div>
  </dialog>
{/each}
