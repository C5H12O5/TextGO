import { fetch } from '@tauri-apps/plugin-http';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase as ChatCompletionParams
} from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';

/** Text returned by a provider, with thinking kept separate from the answer. */
export type LLMResponseChunk = {
  content: string;
  thinking: string;
};

/** OpenAI-compatible providers expose thinking using different optional fields. */
type ResponseMessage = {
  content?: string | null;
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
  reasoning_details?: unknown;
};

/**
 * Normalize streamed deltas and complete messages without duplicating reasoning aliases.
 *
 * @param message - assistant text and optional provider-specific thinking fields
 * @returns separate answer and readable thinking text; encrypted details are ignored
 */
function parseResponseChunk(message?: ResponseMessage): LLMResponseChunk {
  const content = typeof message?.content === 'string' ? message.content : '';
  const thinking = [message?.reasoning_content, message?.reasoning, message?.thinking].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  if (thinking !== undefined) {
    return { content, thinking };
  }

  const details = Array.isArray(message?.reasoning_details) ? message.reasoning_details : [];
  return {
    content,
    thinking: details
      .map((detail) => {
        if (detail?.type === 'reasoning.text' && typeof detail.text === 'string') {
          return detail.text;
        }
        if (detail?.type === 'reasoning.summary' && typeof detail.summary === 'string') {
          return detail.summary;
        }
        return '';
      })
      .join('')
  };
}

/** Default timeout in milliseconds when fetching available models. */
const DEFAULT_MODELS_TIMEOUT_MS = 5000;

/**
 * Extract normalized, deduplicated, and sorted model IDs from a provider `/models` response.
 *
 * @param payload - decoded JSON payload returned by a provider's models endpoint
 * @param normalize - optional per-ID normalizer (e.g. stripping provider prefixes)
 * @returns sorted list of non-empty model IDs
 */
export function extractModelIds(payload: unknown, normalize: (id: string) => string = (id) => id.trim()): string[] {
  const rawList = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray((payload as { models?: unknown }).models)
          ? (payload as { models: unknown[] }).models
          : []
      : [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of rawList) {
    let rawId = '';
    if (typeof item === 'string') {
      rawId = item;
    } else if (item && typeof item === 'object') {
      const record = item as { id?: unknown; name?: unknown };
      if (typeof record.id === 'string') {
        rawId = record.id;
      } else if (typeof record.name === 'string') {
        rawId = record.name;
      }
    }
    const normalized = normalize(rawId);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      ids.push(normalized);
    }
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** Options for fetching available models from a provider. */
export type ListModelsOptions = {
  /** External abort signal for cancelling stale requests. */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (defaults to 5000ms). */
  timeoutMs?: number;
};

/**
 * LLM Client interface.
 */
export interface LLMClient {
  /**
   * Send a chat history and get the assistant's response.
   *
   * @param request - chat completion request parameters
   * @param customParams - request body fields that override generated parameters
   * @returns an async iterable that yields response chunks
   */
  chat(request: ChatCompletionParams, customParams?: Record<string, unknown>): AsyncIterable<LLMResponseChunk>;

  /**
   * Fetch available model IDs from the provider.
   *
   * @param options - optional abort signal and timeout configuration
   * @returns list of available model IDs
   */
  listModels(options?: ListModelsOptions): Promise<string[]>;

  /**
   * Abort the ongoing request.
   */
  abort(): void;
}

/**
 * Base class for OpenAI-compatible LLM clients.
 */
export abstract class OpenAICompatibleClient implements LLMClient {
  protected abortController: AbortController | null = null;
  protected baseUrl: string;
  protected apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async *chat(request: ChatCompletionParams, customParams?: Record<string, unknown>): AsyncIterable<LLMResponseChunk> {
    this.abortController = new AbortController();

    try {
      const body = {
        stream: true,
        model: request.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        max_completion_tokens: request.max_tokens,
        temperature: request.temperature === 1 ? undefined : request.temperature,
        top_p: request.top_p === 1 ? undefined : request.top_p,
        ...customParams
      };
      // send request to OpenAI-compatible endpoint using Tauri's fetch
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(this.errorMessage(response.status, responseText));
      }
      if (!response.body) {
        throw new Error('response body is empty');
      }

      if (body.stream !== true) {
        const completion = (await response.json()) as ChatCompletion;
        const chunk = parseResponseChunk(completion.choices[0]?.message);
        if (chunk.content || chunk.thinking) yield chunk;
        return;
      }

      // use OpenAI SDK's Stream to handle SSE parsing
      const stream = Stream.fromSSEResponse<ChatCompletionChunk>(response, this.abortController);
      for await (const chunk of stream) {
        const responseChunk = parseResponseChunk(chunk.choices[0]?.delta);
        if (responseChunk.content || responseChunk.thinking) yield responseChunk;
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        throw new Error(`request failed: ${error.message}`, { cause: error });
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  async listModels(options?: ListModelsOptions): Promise<string[]> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_MODELS_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = () => controller.abort();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const baseUrl = this.baseUrl.replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: this.getModelsHeaders(),
        signal: controller.signal
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(this.errorMessage(response.status, responseText));
      }

      const payload: unknown = await response.json();
      return extractModelIds(payload, (id) => this.normalizeModelId(id));
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`request timed out after ${timeoutMs}ms`, { cause: error });
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        const abortError = new Error('request aborted', { cause: error });
        abortError.name = 'AbortError';
        throw abortError;
      }
      if (error instanceof Error) {
        throw new Error(`request failed: ${error.message}`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Build request headers for the provider's `/models` endpoint.
   *
   * @returns HTTP headers record
   */
  protected getModelsHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Origin: 'http://localhost'
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Normalize a model ID returned by the provider's `/models` endpoint.
   *
   * @param id - raw model ID
   * @returns normalized model ID
   */
  protected normalizeModelId(id: string): string {
    return id.trim();
  }

  /**
   * Extract error message from response text.
   *
   * @param httpStatus - HTTP status code
   * @param responseText - response body text
   * @returns formatted error message
   */
  private errorMessage(httpStatus: number, responseText: string): string {
    try {
      const response = JSON.parse(responseText);
      if (response?.error?.message) {
        return `${httpStatus} - ${response.error.message}`;
      }
    } catch {
      // ignore JSON parse errors
    }
    // fallback to raw response text
    return `${httpStatus}${!responseText || /<html/i.test(responseText) ? '' : ` - ${responseText}`}`;
  }
}
