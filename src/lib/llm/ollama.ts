import { ollamaHost } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * Ollama REST API client.
 */
export class OllamaClient extends OpenAICompatibleClient {
  constructor() {
    super(ollamaHost.current || 'http://127.0.0.1:11434');
  }
}
