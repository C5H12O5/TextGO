<script lang="ts">
  import { Button, CodeMirror, Icon } from '$lib/components';
  import { createLLMClient, type ChatMessage, type LLMClient } from '$lib/llm';
  import { popupPinned, prompts } from '$lib/stores.svelte';
  import type { Entry } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { marked } from 'marked';
  import {
    ArrowClockwise,
    ArrowCounterClockwise,
    CopySimple,
    PushPin,
    StopCircle,
    TextIndent,
    X
  } from 'phosphor-svelte';
  import { onMount, tick } from 'svelte';

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

  // LLM client instance
  let llmClient: LLMClient | null = $state(null);

  // streaming status
  let streaming: boolean = $state(false);

  // auto scroll status
  let autoScroll = $state(false);

  // scroll container element
  let scrollElement: HTMLElement | null = $state(null);

  // scroll timer
  let scrollTimer: ReturnType<typeof setInterval> | null = $state(null);

  /**
   * Start AI conversation.
   */
  async function chat() {
    if (streaming || !entry?.result || !entry?.model || !entry?.provider) {
      return;
    }

    // create or update LLM client based on provider
    llmClient = createLLMClient(entry.provider);

    let aborted = false;
    try {
      // start streaming
      streaming = true;
      // start auto scroll
      startAutoScroll();
      // add user prompt
      const messages: ChatMessage[] = [{ role: 'user', content: entry.result }];
      // add system prompt
      const systemPrompt = entry.systemPrompt?.trim();
      if (systemPrompt) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
      const response = llmClient.chat({
        model: entry.model,
        messages: messages,
        max_tokens: entry.maxTokens,
        temperature: entry.temperature,
        top_p: entry.topP
      });
      // save reply content
      entry.response = '';
      for await (const chunk of response) {
        if (!streaming) {
          // abort streaming
          break;
        }
        entry.response += chunk;
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
    streaming && llmClient?.abort();
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
      if (entry?.actionType === 'prompt') {
        chat();
      }
      // show and focus window
      currentWindow.isVisible().then((visible) => {
        if (!visible) {
          currentWindow.show();
          currentWindow.setFocus();
        }
      });
      // copy to clipboard if needed
      tick().then(() => {
        if (!promptMode && entry?.copyOnPopup) {
          codeMirror?.copy();
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

{#key entry?.id}
  {@const height = 'calc(100vh - 2.625rem)'}
  <main class="bg-transparent p-1">
    <div class="overflow-hidden rounded-box border shadow-sm">
      <!-- title -->
      <div class="flex h-8 items-center bg-base-300 p-1" data-tauri-drag-region>
        <Button
          icon={PushPin}
          iconWeight="fill"
          iconClass={popupPinned.current ? '-rotate-90' : '-rotate-45 text-base-content/30'}
          onclick={() => (popupPinned.current = !popupPinned.current)}
        />
        <div class="pointer-events-none flex items-center truncate">
          {#if promptMode}
            <Icon icon={promptIcon} class="m-1.5 size-4.5 shrink-0" />
            <span class="truncate text-sm text-base-content/80">{entry?.actionLabel}</span>
          {/if}
        </div>
        <div class="ml-auto flex items-center gap-1">
          {#if promptMode}
            <Button
              icon={StopCircle}
              iconWeight="bold"
              iconClass="opacity-80"
              disabled={!(streaming && entry?.response)}
              onclick={() => abort()}
            />
            <Button
              icon={ArrowClockwise}
              iconWeight="bold"
              iconClass="opacity-80"
              disabled={streaming || !entry?.response}
              onclick={() => chat()}
            />
          {:else}
            <Button icon={ArrowCounterClockwise} onclick={() => codeMirror?.reset()} />
            <Button icon={TextIndent} onclick={() => codeMirror?.format()} />
            <Button icon={CopySimple} onclick={() => codeMirror?.copy()} />
          {/if}
          <div class="divider mx-0 my-auto divider-horizontal h-4 w-1 opacity-50"></div>
          <Button icon={X} onclick={() => currentWindow.hide()} />
        </div>
      </div>
      <!-- body -->
      <div style:height class="overflow-auto bg-base-100" bind:this={scrollElement} onscroll={handleScroll}>
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
            bind:this={codeMirror}
            document={entry?.result}
            minHeight={height}
            maxHeight={height}
            panelClass="hidden"
            class="rounded-none border-none"
          />
        {/if}
      </div>
    </div>
  </main>
{/key}

<style>
  :global {
    html,
    body {
      background: transparent;
    }
  }
</style>
