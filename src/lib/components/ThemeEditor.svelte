<script lang="ts">
  import { enhance } from '$app/forms';
  import { alert } from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import Label from '$lib/components/Label.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { Moon, Sun } from '$lib/icons';
  import { m } from '$lib/paraglide/messages';
  import { customThemes } from '$lib/stores.svelte';
  import { parseDaisyUITheme, type Theme } from '$lib/theme';

  let modal: Modal;
  let theme: Theme = $state('light');
  let css = $state('');

  const modalIcon = $derived(theme === 'light' ? Sun : Moon);
  const modalTitle = $derived(theme === 'light' ? m.custom_light_theme() : m.custom_dark_theme());

  /**
   * Show the custom theme editor.
   *
   * @param targetTheme - theme to edit
   */
  function showModal(targetTheme: Theme) {
    theme = targetTheme;
    css = customThemes.current[theme];
    modal.show();
  }

  /**
   * Validate and save the custom theme.
   */
  function save() {
    const value = css.trim();
    if (value) {
      try {
        parseDaisyUITheme(value);
      } catch {
        alert({ level: 'error', message: m.invalid_custom_theme() });
        return;
      }
    }
    customThemes.current = { ...customThemes.current, [theme]: value };
    modal.close();
  }
</script>

<fieldset class="flex items-center justify-between gap-1">
  <Label>{m.custom_theme()}</Label>
  <div class="flex items-center gap-1">
    <Button
      size="md"
      icon={Sun}
      text={m.custom_light_theme()}
      iconClass={customThemes.current.light.trim() ? 'text-emphasis' : 'text-base-content/30'}
      onclick={() => showModal('light')}
    />
    <Button
      size="md"
      icon={Moon}
      text={m.custom_dark_theme()}
      iconClass={customThemes.current.dark.trim() ? 'text-emphasis' : 'text-base-content/30'}
      onclick={() => showModal('dark')}
    />
  </div>
</fieldset>

<Modal icon={modalIcon} title={modalTitle} maxWidth="42rem" bind:this={modal}>
  <form
    method="post"
    use:enhance={({ cancel }) => {
      cancel();
      save();
    }}
  >
    <textarea
      class="autofocus textarea min-h-80 w-full resize-y font-mono text-xs textarea-sm"
      placeholder={m.custom_theme_placeholder()}
      bind:value={css}></textarea>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => modal.close()}>{m.cancel()}</button>
      <button type="submit" class="btn btn-submit">{m.confirm()}</button>
    </div>
  </form>
</Modal>
