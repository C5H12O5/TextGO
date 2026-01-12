import type { LLMProvider } from '../types';
import type { LLMClient } from './base';
import { LMStudioClient } from './lmstudio';
import { OllamaClient } from './ollama';
import { OpenAIClient } from './openai';

/**
 * Create LLM client based on provider type.
 *
 * @param provider - LLM provider type
 * @returns LLM client instance
 */
export function createLLMClient(provider: LLMProvider): LLMClient {
  switch (provider) {
    case 'ollama':
      return new OllamaClient();
    case 'lmstudio':
      return new LMStudioClient();
    case 'openai':
      return new OpenAIClient();
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

// export types for external usage
export type { ChatCompletionMessageParam as ChatMessage } from 'openai/resources/chat/completions';
export type { LLMClient, LLMProvider };
