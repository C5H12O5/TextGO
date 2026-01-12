import { openaiApiKey } from '$lib/stores.svelte';
import { OpenAICompatibleClient } from './base';

/**
 * OpenAI REST API client.
 */
export class OpenAIClient extends OpenAICompatibleClient {
    constructor() {
        const apiKey = openaiApiKey.current?.trim();
        super('https://api.openai.com', apiKey || undefined);
    }
}
