<script lang="ts" module>
  import { DEFAULT_POPUP_WINDOW_SIZE, MIN_POPUP_WINDOW_SIZE } from '$lib/constants';
  import type { WindowSize } from '$lib/types';

  /**
   * Normalize a saved popup window size before applying it to the native window.
   *
   * @param size - persisted popup size; invalid or missing dimensions fall back to defaults
   * @returns normalized logical popup window size
   */
  function normalizePopupWindowSize(size?: Partial<WindowSize> | null): WindowSize {
    return {
      width: normalizeDimension(size?.width, DEFAULT_POPUP_WINDOW_SIZE.width, MIN_POPUP_WINDOW_SIZE.width),
      height: normalizeDimension(size?.height, DEFAULT_POPUP_WINDOW_SIZE.height, MIN_POPUP_WINDOW_SIZE.height)
    };
  }

  /**
   * Normalize one persisted popup dimension before it is restored.
   *
   * @param value - persisted dimension value
   * @param fallback - default dimension
   * @param min - minimum allowed dimension
   * @returns rounded dimension constrained to the minimum size
   */
  function normalizeDimension(value: number | undefined, fallback: number, min: number): number {
    const dimension = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    return Math.round(Math.max(dimension, min));
  }
</script>

<script lang="ts">
  import { Button, CodeMirror, Icon } from '$lib/components';
  import { createLLMClient, type ChatMessage, type LLMClient } from '$lib/llm';
  import { m } from '$lib/paraglide/messages';
  import { popupPinned, popupWindowSize, prompts } from '$lib/stores.svelte';
  import type { Entry } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { LogicalSize } from '@tauri-apps/api/dpi';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { debounce } from 'es-toolkit/function';
  import { marked } from 'marked';
  import {
    ArrowCircleRightIcon,
    ArrowClockwiseIcon,
    ArrowCounterClockwiseIcon,
    ChatTeardropDotsIcon,
    CopySimpleIcon,
    PushPinIcon,
    StopCircleIcon,
    TextIndentIcon,
    XIcon
  } from 'phosphor-svelte';
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  // current window
  const currentWindow = getCurrentWindow();
  let canPersistWindowSize = false;

  // shortcut trigger record
  let entry: Entry | null = $state(null);

  // determine if in prompt mode
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

  // auto scroll control
  let autoScroll = $state(false);
  let scrollElement: HTMLElement | null = $state(null);
  let scrollTimer: ReturnType<typeof setInterval> | null = $state(null);

  // chat messages history
  let chatMessages: ChatMessage[] = $state([]);
  let replyBox = $state(false);
  let userMessage = $state('');
  let userMessageInput: HTMLInputElement | null = $state(null);

  /**
   * Apply persisted popup window size to native window.
   */
  async function restoreWindowSize() {
    const size = normalizePopupWindowSize(popupWindowSize.current);
    popupWindowSize.current = size;
    await currentWindow.setSize(new LogicalSize(size.width, size.height));
  }

  /**
   * Persist popup window size after native resize events settle.
   */
  const saveWindowSize = debounce((size: WindowSize) => {
    if (!canPersistWindowSize) {
      return;
    }
    popupWindowSize.current = normalizePopupWindowSize(size);
  }, 200);

  /**
   * Start AI conversation.
   *
   * @param message - optional user message
   */
  async function chat(message?: string) {
    if (streaming || !entry?.model || !entry?.provider) {
      return;
    }

    // determine user message
    const userMessage = message || entry?.result;
    if (!userMessage) {
      return;
    }

    let aborted = false;
    try {
      // create or update LLM client based on provider
      llmClient = createLLMClient(entry.provider);

      // start streaming
      streaming = true;
      // start auto scroll
      startAutoScroll();

      // build messages array
      const messages: ChatMessage[] = [];

      // add system prompt
      const systemPrompt = entry.systemPrompt?.trim();
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      // add chat history if exists
      if (chatMessages.length > 0) {
        messages.push(...chatMessages);
      }

      // add current user message
      messages.push({ role: 'user', content: userMessage });

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

      // save to chat history
      if (entry.response) {
        chatMessages.push({ role: 'user', content: userMessage });
        chatMessages.push({ role: 'assistant', content: entry.response });
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
   * Continue AI conversation.
   */
  function reply() {
    const message = userMessage.trim();
    if (!message) {
      return;
    }
    replyBox = false;
    userMessage = '';
    chat(message);
  }

  /**
   * Abort AI conversation.
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

  /**
   * Handle link click events in rendered HTML.
   *
   * @param event - mouse event
   */
  function handleLinkClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // check if clicked element is a link
    if (target.tagName === 'A' && target instanceof HTMLAnchorElement) {
      const href = target.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();
        openUrl(href);
      }
    }
  }

  onMount(() => {
    let unlistenResize: (() => void) | undefined;
    let mounted = true;

    void (async () => {
      try {
        // wait for persisted size so the first native resize uses the stored value
        await popupWindowSize.ready;
        await restoreWindowSize();
      } catch (error) {
        console.error(`Failed to restore popup window size: ${error}`);
      } finally {
        // mark popup as initialized after the first size restore attempt
        await invoke('mark_popup_initialized');
      }

      try {
        const unlisten = await currentWindow.onResized(({ payload }) => {
          if (!mounted || !canPersistWindowSize) {
            return;
          }
          void currentWindow
            .scaleFactor()
            .then((scaleFactor) => {
              saveWindowSize({
                width: payload.width / scaleFactor,
                height: payload.height / scaleFactor
              });
            })
            .catch((error) => {
              console.error(`Failed to persist popup window size: ${error}`);
            });
        });
        // the async listener registration may resolve after the component has already unmounted
        if (!mounted) {
          unlisten();
          return;
        }
        unlistenResize = unlisten;
        canPersistWindowSize = true;
      } catch (error) {
        console.error(`Failed to listen for popup window resize: ${error}`);
      }
    })();

    return () => {
      mounted = false;
      canPersistWindowSize = false;
      saveWindowSize.cancel();
      unlistenResize?.();
    };
  });

  onMount(() => {
    const setup = (data: Entry | null) => {
      entry = data;
      abort();
      // reset chat history
      chatMessages = [];
      replyBox = false;
      userMessage = '';
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
  <main class="h-screen bg-transparent p-0.5 pb-0.75">
    <div class="flex h-full flex-col overflow-hidden rounded-box border shadow-sm">
      <!-- popup window title -->
      <div class="flex h-8 shrink-0 items-center bg-base-300 p-1">
        <Button
          icon={PushPinIcon}
          iconWeight="fill"
          iconClass={popupPinned.current ? '-rotate-90' : '-rotate-45 text-base-content/30'}
          onclick={() => (popupPinned.current = !popupPinned.current)}
        />
        <div
          class="flex h-full min-w-0 flex-1 cursor-grab items-center truncate active:cursor-grabbing"
          data-tauri-drag-region
        >
          {#if promptMode}
            <Icon icon={promptIcon} class="pointer-events-none m-1.5 size-4.5 shrink-0" />
            <span class="pointer-events-none truncate text-sm text-base-content/80">{entry?.actionLabel}</span>
          {/if}
        </div>
        <div class="ml-auto flex items-center gap-1">
          {#if promptMode}
            <Button
              icon={StopCircleIcon}
              iconWeight="bold"
              iconClass="opacity-80"
              disabled={!(streaming && entry?.response)}
              onclick={() => abort()}
            />
            <Button
              icon={ArrowClockwiseIcon}
              iconWeight="bold"
              iconClass="opacity-80"
              disabled={streaming || !entry?.response}
              onclick={() => chat()}
            />
          {:else}
            <Button icon={ArrowCounterClockwiseIcon} onclick={() => codeMirror?.reset()} />
            <Button icon={TextIndentIcon} onclick={() => codeMirror?.format()} />
            <Button icon={CopySimpleIcon} onclick={() => codeMirror?.copy()} />
          {/if}
          <div class="divider mx-0 my-auto divider-horizontal h-4 w-1 opacity-50"></div>
          <Button icon={XIcon} onclick={() => currentWindow.hide()} />
        </div>
      </div>
      <!-- popup window body -->
      <div class="min-h-0 flex-1 overflow-auto bg-base-100" bind:this={scrollElement} onscroll={handleScroll}>
        {#if promptMode}
          <div class="px-4 pt-2 pb-10">
            {#if streaming && !entry?.response}
              <div class="loading loading-sm loading-dots opacity-70"></div>
            {:else if entry?.response}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="prose prose-sm max-w-none text-base-content/90" onclick={handleLinkClick}>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html marked(entry.response + (streaming ? ' |' : ''))}
              </div>
            {/if}
          </div>
          <!-- continue chat button -->
          {#if !streaming && entry?.response && !replyBox}
            <button
              class="btn fixed right-3 bottom-3 btn-circle bg-base-300/80 btn-ghost btn-sm hover:bg-base-300"
              onclick={() => {
                replyBox = true;
                tick().then(() => {
                  userMessageInput?.focus();
                });
              }}
              transition:fade={{ duration: 150 }}
            >
              <ChatTeardropDotsIcon class="size-4.5 -scale-x-100 opacity-70" />
            </button>
          {/if}
          <!-- continue chat input -->
          {#if replyBox}
            <div
              class="fixed inset-x-0.5 top-8.5 bottom-0.75 z-50 flex items-end justify-center rounded-b-box bg-black/20"
              transition:fade={{ duration: 150 }}
            >
              <label
                class="input mx-4 mb-3 w-full rounded-box border-0 bg-base-100/95 shadow-lg"
                transition:fly={{ y: 20, duration: 150 }}
              >
                <input
                  type="text"
                  class="grow"
                  spellcheck="false"
                  placeholder={m.continue_chat()}
                  bind:value={userMessage}
                  bind:this={userMessageInput}
                  onblur={() => setTimeout(() => (replyBox = false), 200)}
                  onkeydown={(event) => event.key === 'Enter' && reply()}
                />
                <Button size="sm" icon={ArrowCircleRightIcon} onclick={reply} disabled={!userMessage.trim()} />
              </label>
            </div>
          {/if}
        {:else}
          <!-- show result in CodeMirror in non-prompt mode -->
          <CodeMirror
            bind:this={codeMirror}
            document={entry?.result}
            minHeight="100%"
            maxHeight="100%"
            panelClass="hidden"
            class="h-full rounded-none border-none"
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
