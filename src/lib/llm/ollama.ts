import { ollamaHost } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * Ollama REST API client.
 *
 * https://docs.ollama.com/api/openai-compatibility
 */
export class OllamaClient extends OpenAICompatibleClient {
  constructor() {
    const host = (ollamaHost.current || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    super(`${host}/v1`, 'ollama');
  }
}
