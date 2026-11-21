import { lmstudioHost } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * LM Studio REST API client.
 *
 * https://lmstudio.ai/docs/developer/openai-compat
 */
export class LMStudioClient extends OpenAICompatibleClient {
  constructor() {
    const host = (lmstudioHost.current || 'http://127.0.0.1:1234').replace(/\/+$/, '');
    super(`${host}/v1`, 'lm-studio');
  }
}
