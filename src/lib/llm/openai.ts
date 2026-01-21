import { openaiApiKey } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * OpenAI REST API client.
 *
 * https://platform.openai.com/docs/api-reference/chat
 */
export class OpenAIClient extends OpenAICompatibleClient {
  constructor() {
    const apiKey = openaiApiKey.current;
    if (!apiKey) {
      throw new Error('OpenAI API key is not set');
    }
    super('https://api.openai.com/v1', apiKey);
  }
}
