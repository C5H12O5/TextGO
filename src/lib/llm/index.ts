import type { LLMProvider } from '$lib/types';
import type { LLMClient } from './base';

import { providers } from '$lib/stores.svelte';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './base';
import { GeminiClient } from './google';
import { LMStudioClient } from './lmstudio';
import { OllamaClient } from './ollama';
import { OpenAIClient } from './openai';
import { OpenRouterClient } from './openrouter';
import { XAIClient } from './xai';

/**
 * Custom LLM client for user-defined providers.
 */
class CustomLLMClient extends OpenAICompatibleClient {
  constructor(baseUrl: string, apiKey: string) {
    super(baseUrl, apiKey);
  }
}

/**
 * Create LLM client based on provider type.
 *
 * @param provider - LLM provider type
 * @returns LLM client instance
 */
export function createLLMClient(provider: LLMProvider | string): LLMClient {
  switch (provider) {
    case 'ollama':
      return new OllamaClient();
    case 'lmstudio':
      return new LMStudioClient();
    case 'openrouter':
      return new OpenRouterClient();
    case 'openai':
      return new OpenAIClient();
    case 'anthropic':
      return new AnthropicClient();
    case 'google':
      return new GeminiClient();
    case 'xai':
      return new XAIClient();
    default: {
      // check if it's a custom provider
      const customProvider = providers.current.find((p) => p.name === provider);
      if (customProvider) {
        return new CustomLLMClient(customProvider.baseUrl, customProvider.apiKey);
      }
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}

// export types for external usage
export type { ChatCompletionMessageParam as ChatMessage } from 'openai/resources/chat/completions';
export type { LLMClient, LLMProvider };
