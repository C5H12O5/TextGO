import type { LLMProvider } from '../types';
import { AnthropicClient } from './anthropic';
import type { LLMClient } from './base';
import { GeminiClient } from './google';
import { LMStudioClient } from './lmstudio';
import { OllamaClient } from './ollama';
import { OpenAIClient } from './openai';
import { XAIClient } from './xai';
import { OpenRouterClient } from './openrouter';

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
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

// export types for external usage
export type { ChatCompletionMessageParam as ChatMessage } from 'openai/resources/chat/completions';
export type { LLMClient, LLMProvider };
