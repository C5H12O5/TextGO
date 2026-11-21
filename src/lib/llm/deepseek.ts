import { deepseekApiKey } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * DeepSeek REST API client.
 *
 * https://api-docs.deepseek.com/api/create-chat-completion
 */
export class DeepSeekClient extends OpenAICompatibleClient {
  constructor() {
    const apiKey = deepseekApiKey.current;
    if (!apiKey) {
      throw new Error('DeepSeek API key is not set');
    }
    super('https://api.deepseek.com/v1', apiKey);
  }
}
