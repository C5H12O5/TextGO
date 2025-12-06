<script lang="ts" module>
  import { X, type IconComponentProps } from 'phosphor-svelte';
  import type { Component, Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  export type ModalProps = Partial<{
    /** Modal dialog icon. */
    icon: Component<IconComponentProps>;
    /** Modal dialog title. */
    title: string;
    /** Modal dialog content snippet. */
    children: Snippet;
    /** Maximum width of modal dialog. */
    maxWidth: string;
    /** Custom style class name. */
    class: string;
    boxClass: string;
    cornerClass: string;
    /** Callback function when dialog closes. */
    onclose: () => void;
  }>;

  // reactive map of modal dialogs
  export const modals = new SvelteMap<string, ModalProps>();
</script>

<script lang="ts">
  import { Alert } from '$lib/components';
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';

  let { icon, title, children, maxWidth, class: _class, boxClass, cornerClass, onclose }: ModalProps = $props();
  let dialog: HTMLDialogElement | null = $state(null);
  const id: string = `modal-${crypto.randomUUID()}`;

  /**
   * Show modal dialog.
   */
  export function show() {
    modals.set(id, { onclose });
    tick().then(() => {
      if (!dialog) {
        return;
      }
      dialog.showModal();

      // disable spellcheck for all inputs in this modal
      dialog.querySelectorAll('input, textarea').forEach((element) => {
        (element as HTMLInputElement | HTMLTextAreaElement).spellcheck = false;
      });

      // set focus on the first input with autofocus class
      const autofocus = dialog?.querySelector('.autofocus') as HTMLElement | null;
      if (autofocus) {
        setTimeout(() => autofocus.focus(), 0);
      }
    });
  }

  /**
   * Close modal dialog.
   *
   * @param event - mouse event that triggered the close operation
   */
  export function close(event: MouseEvent | null = null) {
    if (event) {
      event.preventDefault();
    }
    let modal = modals.get(id);
    if (modal) {
      modal.onclose?.();
      modals.delete(id);
    }
  }

  /**
   * Check if modal dialog is currently open.
   *
   * @return true if modal dialog is open, otherwise false
   */
  export function isOpen(): boolean {
    return modals.has(id);
  }
</script>

{#if modals.has(id)}
  <dialog {id} class="modal transition-none {_class}" bind:this={dialog} transition:fade={{ duration: 200 }}>
    <form method="dialog" class="modal-backdrop">
      <button onclick={close} aria-label="Close"></button>
    </form>
    <div class="modal-box {boxClass}" style:max-width={maxWidth}>
      <form method="dialog" class="modal-corner {cornerClass}">
        <button onclick={close}><X /></button>
      </form>
      {#if title}
        <h3 class="modal-title">
          {#if icon}
            {@const Icon = icon}
            <Icon class="size-6" />
          {/if}
          {title}
        </h3>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    </div>
    <Alert dialog />
  </dialog>
{/if}
