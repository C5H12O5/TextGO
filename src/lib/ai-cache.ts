import { invoke } from '@tauri-apps/api/core';

export async function getCachedAIResponse(prompt: string): Promise<string | null> {
  return invoke<string | null>('ai_cache_get', { prompt });
}

export async function setCachedAIResponse(prompt: string, response: string): Promise<void> {
  await invoke('ai_cache_set', { prompt, response });
}