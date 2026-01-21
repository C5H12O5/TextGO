import { xaiApiKey } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * xAI REST API client.
 *
 * https://docs.x.ai/docs/api-reference#chat-completions
 */
export class XAIClient extends OpenAICompatibleClient {
  constructor() {
    const apiKey = xaiApiKey.current;
    if (!apiKey) {
      throw new Error('xAI API key is not set');
    }
    super('https://api.x.ai/v1', apiKey);
  }
}
