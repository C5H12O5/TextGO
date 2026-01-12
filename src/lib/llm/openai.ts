import { OpenAICompatibleClient } from './base';

/**
 * OpenAI REST API client.
 */
export class OpenAIClient extends OpenAICompatibleClient {
    constructor(apiKey?: string) {
        super('https://api.openai.com', apiKey || undefined);
    }
}
