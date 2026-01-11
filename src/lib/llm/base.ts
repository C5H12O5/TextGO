import { fetch } from '@tauri-apps/plugin-http';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase as ChatCompletionParams
} from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';

/**
 * LLM Client interface.
 */
export interface LLMClient {
  /**
   * Send a chat history and get the assistant's response.
   *
   * @param request - chat completion request parameters
   * @returns an async iterable that yields response chunks
   */
  chat(request: ChatCompletionParams): AsyncIterable<string>;

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
  protected host: string;

  constructor(host: string) {
    this.host = host;
  }

  async *chat(request: ChatCompletionParams): AsyncIterable<string> {
    this.abortController = new AbortController();

    try {
      // send request to OpenAI-compatible endpoint using Tauri's fetch
      const response = await fetch(`${this.host}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: true
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`${response.status}${error ? ` - ${error}` : ''}`);
      }
      if (!response.body) {
        throw new Error('response body is empty');
      }

      // use OpenAI SDK's Stream to handle SSE parsing
      const stream = Stream.fromSSEResponse<ChatCompletionChunk>(response, this.abortController);
      for await (const chunk of stream) {
        yield chunk.choices[0]?.delta.content || '';
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        throw new Error(`request failed: ${error.message}`);
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
}
