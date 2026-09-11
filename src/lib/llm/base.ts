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
        if (detail?.type === 'reasoning.text' && typeof detail.text === 'string') return detail.text;
        if (detail?.type === 'reasoning.summary' && typeof detail.summary === 'string') return detail.summary;
        return '';
      })
      .join('')
  };
}

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

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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
