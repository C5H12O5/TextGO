<script lang="ts" module>
  import type CodeMirror from '$lib/components/CodeMirror.svelte';
  import { DEFAULT_POPUP_WINDOW_SIZE, MIN_POPUP_WINDOW_SIZE, POPUP_CORNER_RADIUS } from '$lib/constants';
  import type { ChatMessage, LLMClient } from '$lib/llm';
  import type { Entry, WindowSize } from '$lib/types';

  /** Message displayed in the popup conversation. */
  type ConversationMessage = {
    /** Message author supported by the conversation UI. */
    role: Extract<ChatMessage['role'], 'user' | 'assistant'>;
    /** Plain-text message content. */
    content: string;
    /** Whether the content is a provider error excluded from future context. */
    error?: boolean;
  };

  /**
   * Start a new or regenerated assistant turn.
   *
   * @param messages - current visible conversation messages
   * @param userContent - optional new user message; omit it when regenerating the latest assistant turn
   * @returns new conversation messages ending with an empty assistant placeholder
   */
  function startAssistantTurn(messages: ConversationMessage[], userContent?: string): ConversationMessage[] {
    const nextMessages = [...messages];
    if (userContent === undefined) {
      if (nextMessages.at(-1)?.role === 'assistant') {
        nextMessages.pop();
      }
    } else {
      nextMessages.push({ role: 'user', content: userContent });
    }
    return [...nextMessages, { role: 'assistant', content: '' }];
  }

  /**
   * Keep a partial aborted response, or remove an empty assistant placeholder.
   *
   * @param messages - current visible conversation messages
   * @returns new conversation messages after applying the abort state
   */
  function abortAssistantMessage(messages: ConversationMessage[]): ConversationMessage[] {
    const index = findLatestAssistantIndex(messages);
    if (index >= 0 && !messages[index]?.content) {
      return messages.filter((_, messageIndex) => messageIndex !== index);
    }
    return [...messages];
  }

  /**
   * Find the latest assistant message.
   *
   * @param messages - visible conversation messages
   * @returns latest assistant message index, or -1 when no assistant message exists
   */
  function findLatestAssistantIndex(messages: ConversationMessage[]): number {
    return messages.findLastIndex((message) => message.role === 'assistant');
  }

  /**
   * Apply an immutable update to the latest assistant message.
   *
   * @param messages - current visible conversation messages
   * @param update - function that returns the updated assistant message
   * @returns new conversation messages containing the updated assistant message
   */
  function updateLatestAssistant(
    messages: ConversationMessage[],
    update: (message: ConversationMessage) => ConversationMessage
  ): ConversationMessage[] {
    const index = findLatestAssistantIndex(messages);
    if (index < 0) {
      return [...messages];
    }
    return messages.map((message, messageIndex) => (messageIndex === index ? update(message) : message));
  }

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
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { m } from '$lib/paraglide/messages';
  import { popupCornerRadius, popupPinned, popupWindowSize, prompts } from '$lib/stores.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { LogicalSize } from '@tauri-apps/api/dpi';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { debounce } from 'es-toolkit/function';
  import { marked } from 'marked';
  import ArrowCircleRightIcon from 'phosphor-svelte/lib/ArrowCircleRightIcon';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
  import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
  import ChatTeardropDotsIcon from 'phosphor-svelte/lib/ChatTeardropDotsIcon';
  import CopySimpleIcon from 'phosphor-svelte/lib/CopySimpleIcon';
  import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
  import StopCircleIcon from 'phosphor-svelte/lib/StopCircleIcon';
  import TextIndentIcon from 'phosphor-svelte/lib/TextIndentIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  // current window
  const currentWindow = getCurrentWindow();
  let canPersistWindowSize = false;

  // popup corner radius style
  let cornerRadiusStyle = $derived.by(() => {
    const value = popupCornerRadius.current;
    if (!Number.isFinite(value)) {
      return `${POPUP_CORNER_RADIUS.default}px`;
    }
    const cornerRadius = Math.min(POPUP_CORNER_RADIUS.max, Math.max(POPUP_CORNER_RADIUS.min, Math.trunc(value)));
    return `${cornerRadius}px`;
  });

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

  // CodeMirror lazy component and instance
  let codeMirrorComponent: Promise<{ default: typeof CodeMirror }> | null = $state(null);
  let codeMirror: CodeMirror | null = $state(null);

  // LLM client instance
  let llmClient: LLMClient | null = $state(null);
  let chatRequestId = 0;

  // streaming status
  let streaming: boolean = $state(false);

  // auto scroll control
  let autoScroll = $state(false);
  let scrollElement: HTMLElement | null = $state(null);
  let scrollTimer: ReturnType<typeof setInterval> | null = $state(null);

  // chat messages history
  let chatMessages: ConversationMessage[] = $state([]);
  let latestAssistant = $derived(chatMessages.findLast((message) => message.role === 'assistant'));
  let conversationMode = $derived(chatMessages.filter((message) => message.role === 'user').length > 1);
  let canRegenerate = $derived(!!latestAssistant || chatMessages.at(-1)?.role === 'user');

  // reply box state
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
   * Mirror response content to the initial entry without overwriting it during continuous conversation.
   *
   * @param response - latest initial assistant response content
   */
  function syncInitialResponse(response: string) {
    if (!conversationMode && entry) {
      entry.response = response;
    }
  }

  /**
   * Start AI conversation.
   *
   * @param message - optional user message
   * @param regenerate - whether to regenerate an existing assistant turn
   * @returns promise that resolves after the assistant request finishes
   */
  async function chat(message?: string, regenerate = false) {
    if (streaming || !entry?.model || !entry?.provider) {
      return;
    }

    const userMessage = message ?? entry.result;
    if (regenerate && conversationMode) {
      if (chatMessages.length === 0) {
        return;
      }
      chatMessages = startAssistantTurn(chatMessages);
    } else {
      if (!userMessage) {
        return;
      }
      chatMessages = startAssistantTurn(regenerate ? [] : chatMessages, userMessage);
    }

    const requestId = ++chatRequestId;
    syncInitialResponse('');
    streaming = true;
    startAutoScroll();

    try {
      const { createLLMClient } = await import('$lib/llm');
      if (requestId !== chatRequestId) {
        return;
      }
      llmClient = createLLMClient(entry.provider);

      // build messages array
      const messages: ChatMessage[] = [];

      // add system prompt
      const systemPrompt = entry.systemPrompt?.trim();
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      messages.push(
        ...chatMessages
          .filter((message) => message.content.length > 0 && !message.error)
          .map(({ role, content }) => ({ role, content }) as ChatMessage)
      );

      const response = llmClient.chat({
        model: entry.model,
        messages: messages,
        max_tokens: entry.maxTokens,
        temperature: entry.temperature,
        top_p: entry.topP
      });

      for await (const chunk of response) {
        if (requestId !== chatRequestId || !streaming) {
          break;
        }
        chatMessages = updateLatestAssistant(chatMessages, (message) => ({
          ...message,
          content: message.content + chunk
        }));
        syncInitialResponse(latestAssistant?.content ?? '');
      }
    } catch (error) {
      if (requestId !== chatRequestId) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        chatMessages = abortAssistantMessage(chatMessages);
      } else {
        const errorMessage = error instanceof Error ? error.message : '';
        chatMessages = updateLatestAssistant(chatMessages, (message) => ({
          ...message,
          content: errorMessage || 'An unknown error occurred',
          error: true
        }));
      }
      syncInitialResponse(latestAssistant?.content ?? '');
    } finally {
      if (requestId === chatRequestId) {
        stopAutoScroll();
        streaming = false;
        llmClient = null;
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
    if (!streaming) {
      return;
    }
    chatRequestId += 1;
    stopAutoScroll();
    llmClient?.abort();
    llmClient = null;
    chatMessages = abortAssistantMessage(chatMessages);
    syncInitialResponse(latestAssistant?.content ?? '');
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
    if (streaming) {
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
      abort();
      entry = data;
      codeMirror = null;
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
      } else {
        codeMirrorComponent ??= import('$lib/components/CodeMirror.svelte');
      }
      // show and focus window
      currentWindow.isVisible().then((visible) => {
        if (!visible) {
          currentWindow.show();
          currentWindow.setFocus();
        }
      });
      // copy to clipboard if needed
      tick().then(async () => {
        if (!promptMode && entry?.copyOnPopup) {
          await codeMirrorComponent;
          await tick();
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
    <div class="flex h-full flex-col overflow-hidden border shadow-sm" style:border-radius={cornerRadiusStyle}>
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
              disabled={!streaming}
              onclick={() => abort()}
            />
            <Button
              icon={ArrowClockwiseIcon}
              iconWeight="bold"
              iconClass="opacity-80"
              disabled={streaming || !canRegenerate}
              onclick={() => {
                replyBox = false;
                userMessage = '';
                chat(undefined, true);
              }}
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
          {#if conversationMode}
            <div class="space-y-4 px-4 pt-3 pb-20">
              {#each chatMessages as message, index (index)}
                {#if message.role === 'user'}
                  <div class="flex justify-end">
                    <div class="max-w-[85%] rounded-box gradient bg-emphasis/15 px-3 py-2 text-sm whitespace-pre-wrap">
                      {message.content}
                    </div>
                  </div>
                {:else if message.error}
                  <div class="text-sm whitespace-pre-wrap text-error">{message.content}</div>
                {:else if streaming && index === chatMessages.length - 1 && !message.content}
                  <div class="loading loading-sm loading-dots opacity-70"></div>
                {:else if message.content}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="prose prose-sm max-w-none text-base-content/90" onclick={handleLinkClick}>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html marked(message.content + (streaming && index === chatMessages.length - 1 ? ' |' : ''))}
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="px-4 pt-2 pb-10">
              {#if streaming && !latestAssistant?.content}
                <div class="loading loading-sm loading-dots opacity-70"></div>
              {:else if latestAssistant?.error}
                <div class="text-sm whitespace-pre-wrap text-error">{latestAssistant.content}</div>
              {:else if latestAssistant?.content}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="prose prose-sm max-w-none text-base-content/90" onclick={handleLinkClick}>
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html marked(latestAssistant.content + (streaming ? ' |' : ''))}
                </div>
              {/if}
            </div>
          {/if}
          <!-- continue chat button -->
          {#if !conversationMode && !streaming && latestAssistant?.content && !replyBox}
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
          {#if !conversationMode && replyBox}
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
                  onkeydown={(event) => event.key === 'Enter' && !event.isComposing && reply()}
                />
                <Button size="sm" icon={ArrowCircleRightIcon} onclick={reply} disabled={!userMessage.trim()} />
              </label>
            </div>
          {/if}
          <!-- fixed composer in continuous chat mode -->
          {#if conversationMode}
            <div class="fixed inset-x-0.5 bottom-0.75 z-40 flex items-end justify-center">
              <label class="input mx-4 mb-3 w-full rounded-box border bg-base-100/95 shadow-lg">
                <input
                  type="text"
                  class="grow"
                  spellcheck="false"
                  placeholder={m.continue_chat()}
                  bind:value={userMessage}
                  bind:this={userMessageInput}
                  onkeydown={(event) => event.key === 'Enter' && !event.isComposing && !streaming && reply()}
                />
                <Button
                  size="sm"
                  icon={ArrowCircleRightIcon}
                  onclick={reply}
                  disabled={streaming || !userMessage.trim()}
                />
              </label>
            </div>
          {/if}
        {:else if codeMirrorComponent}
          <!-- show result in CodeMirror in non-prompt mode -->
          {#await codeMirrorComponent}
            <div class="flex h-full items-center justify-center">
              <div class="loading loading-sm loading-dots opacity-70"></div>
            </div>
          {:then { default: Editor }}
            <Editor
              bind:this={codeMirror}
              document={entry?.result}
              minHeight="100%"
              maxHeight="100%"
              panelClass="hidden"
              class="h-full rounded-none border-none"
            />
          {/await}
        {:else}
          <div class="flex h-full items-center justify-center">
            <div class="loading loading-sm loading-dots opacity-70"></div>
          </div>
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
