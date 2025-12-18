<script lang="ts">
  import { Button, CodeMirror, Icon } from '$lib/components';
  import { ollamaHost, prompts } from '$lib/stores.svelte';
  import type { Entry } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { type } from '@tauri-apps/plugin-os';
  import { marked } from 'marked';
  import { Ollama } from 'ollama/browser';
  import { ArrowClockwise, ArrowCounterClockwise, CopySimple, StopCircle, TextIndent } from 'phosphor-svelte';
  import { onMount } from 'svelte';

  // operating system type
  const osType = type();

  // current window
  const currentWindow = getCurrentWindow();

  // shortcut trigger record
  let entry: Entry | null = $state(null);

  // check if in prompt mode
  let promptMode: boolean = $derived.by(() => entry?.actionType === 'prompt');
  let promptIcon: string = $derived.by(() => {
    let icon = 'Robot';
    if (promptMode) {
      const prompt = prompts.current.find((p) => p.id === entry?.actionLabel);
      icon = prompt?.icon || icon;
    }
    return icon;
  });

  // CodeMirror instance
  let codeMirror: CodeMirror | null = $state(null);

  // Ollama instance
  let ollama = new Ollama();
  $effect(() => {
    ollama = new Ollama({ host: ollamaHost.current || undefined });
  });

  // streaming status
  let streaming: boolean = $state(false);

  // auto scroll status
  let autoScroll = $state(false);

  // scroll container element
  let scrollElement: HTMLElement | null = $state(null);

  // scroll timer
  let scrollTimer: ReturnType<typeof setInterval> | null = $state(null);

  /**
   * Start conversation.
   */
  async function chat() {
    if (streaming || !entry || !entry.result || !entry.model || entry.actionType !== 'prompt') {
      return;
    }
    let aborted = false;
    try {
      // start streaming
      streaming = true;
      // start auto scroll
      startAutoScroll();
      // add user prompt
      const messages = [{ role: 'user', content: entry.result }];
      // add system prompt
      const systemPrompt = entry.systemPrompt?.trim();
      if (systemPrompt) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
      const response = await ollama.chat({
        model: entry.model,
        messages: messages,
        stream: true
      });
      // save reply content
      entry.response = '';
      for await (const part of response) {
        if (!streaming) {
          // abort streaming
          break;
        }
        entry.response += part.message.content;
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          aborted = true;
        } else {
          entry.response = error.message || 'An unknown error occurred';
        }
      }
    } finally {
      if (!aborted) {
        // stop auto scroll
        stopAutoScroll();
        // end streaming
        streaming = false;
      }
    }
  }

  /**
   * Abort conversation.
   */
  function abort() {
    autoScroll && stopAutoScroll();
    streaming && ollama.abort();
    streaming = false;
  }

  /**
   * Start auto scroll.
   */
  function startAutoScroll() {
    if (scrollTimer) {
      clearInterval(scrollTimer);
    }
    autoScroll = true;
    scrollTimer = setInterval(() => {
      if (autoScroll && scrollElement) {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  }

  /**
   * Stop auto scroll.
   */
  function stopAutoScroll() {
    if (scrollTimer) {
      clearInterval(scrollTimer);
    }
    autoScroll = false;
    scrollTimer = null;
  }

  /**
   * Handle user scroll event
   *
   * @param event - scroll event
   */
  function handleScroll(event: Event) {
    if (streaming && entry?.response) {
      const target = event.target as HTMLElement;
      if (autoScroll) {
        // if user scrolls up, stop auto scroll
        const isScrollingUp = target.scrollTop + target.clientHeight < target.scrollHeight - 10;
        if (isScrollingUp) {
          stopAutoScroll();
        }
      } else {
        // if user scrolls to bottom, restore auto scroll
        const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 10;
        if (isAtBottom) {
          startAutoScroll();
        }
      }
    }
  }

  onMount(async () => {
    // mark popup as initialized
    await invoke('mark_popup_initialized');
  });

  onMount(() => {
    const setup = (data: Entry | null) => {
      entry = data;
      abort();
    };

    // listen to window show/hide events
    const unlistenWindowShow = listen<string>('show-popup', (event) => {
      setup(JSON.parse(event.payload) as Entry);
      // start chat if in prompt mode
      chat();
      // show and focus window
      currentWindow.isVisible().then((visible) => {
        if (!visible) {
          currentWindow.show();
          currentWindow.setFocus();
        }
      });
    });
    const unlistenWindowHide = listen('hide-popup', () => {
      setup(null);
    });

    return () => {
      setup(null);
      unlistenWindowShow.then((fn) => fn());
      unlistenWindowHide.then((fn) => fn());
    };
  });
</script>

{#snippet panel()}
  <div class="pointer-events-none flex items-center gap-2 truncate">
    {#if promptMode}
      <Icon icon={promptIcon} class="size-4.5 shrink-0" />
      <span class="truncate text-sm text-base-content/80">{entry?.actionLabel}</span>
    {/if}
  </div>
  <div class="flex items-center gap-1">
    {#if promptMode}
      <Button icon={ArrowClockwise} weight="bold" disabled={streaming || !entry?.response} onclick={() => chat()} />
      <Button icon={StopCircle} weight="bold" disabled={!(streaming && entry?.response)} onclick={() => abort()} />
    {:else}
      <Button icon={ArrowCounterClockwise} onclick={() => codeMirror?.reset()} />
      <Button icon={TextIndent} onclick={() => codeMirror?.format()} />
      <Button icon={CopySimple} onclick={() => codeMirror?.copy()} />
    {/if}
  </div>
{/snippet}

{#key entry?.id}
  <main class="h-screen w-screen overflow-hidden">
    {#if osType === 'macos'}
      <div class="flex h-8 items-center justify-between gap-2 bg-base-300 px-2 pl-20" data-tauri-drag-region>
        {@render panel()}
      </div>
    {/if}
    <div class="h-[calc(100vh-2rem)] w-full overflow-auto" bind:this={scrollElement} onscroll={handleScroll}>
      {#if promptMode}
        <div class="px-4 pt-2 pb-10">
          {#if streaming && !entry?.response}
            <div class="loading loading-sm loading-dots opacity-70"></div>
          {:else if entry?.response}
            <div class="prose prose-sm max-w-none text-base-content/90">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html marked(entry.response + (streaming ? ' |' : ''))}
            </div>
          {/if}
        </div>
      {:else}
        <CodeMirror
          minHeight="calc(100vh - 2rem)"
          maxHeight="calc(100vh - 2rem)"
          class="rounded-none border-none"
          panelClass="hidden"
          document={entry?.result}
          bind:this={codeMirror}
        />
      {/if}
    </div>
    {#if osType !== 'macos'}
      <div class="flex h-8 items-center justify-between gap-2 bg-base-300 px-2">
        {@render panel()}
      </div>
    {/if}
  </main>
{/key}
