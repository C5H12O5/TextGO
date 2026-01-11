import { lmstudioHost } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * LM Studio REST API client.
 */
export class LMStudioClient extends OpenAICompatibleClient {
  constructor() {
    super(lmstudioHost.current || 'http://127.0.0.1:1234');
  }
}
