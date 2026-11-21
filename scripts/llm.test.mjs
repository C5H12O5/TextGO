import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

function loadLlmModules(fetchImpl) {
  const cache = new Map();

  function compileTs(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    return ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
  }

  const storesStub = {
    anthropicApiKey: { current: 'sk-ant-test' },
    geminiApiKey: { current: 'gem-test' },
    deepseekApiKey: { current: 'sk-ds-test' }
  };

  function load(relativePath) {
    if (cache.has(relativePath)) {
      return cache.get(relativePath);
    }
    const exports = {};
    const module = { exports };
    cache.set(relativePath, exports);

    const customRequire = (specifier) => {
      if (specifier === '@tauri-apps/plugin-http') {
        return { fetch: fetchImpl };
      }
      if (specifier === 'openai/streaming') {
        return { Stream: { fromSSEResponse: () => [] } };
      }
      if (specifier === '$lib/stores.svelte') {
        return storesStub;
      }
      if (specifier === './base') {
        return load('../src/lib/llm/base.ts');
      }
      throw new Error(`Unexpected import: ${specifier}`);
    };

    const context = createContext({
      exports,
      module,
      require: customRequire,
      AbortController,
      setTimeout,
      clearTimeout
    });
    runInContext(compileTs(relativePath), context);
    cache.set(relativePath, module.exports);
    return module.exports;
  }

  return {
    base: load('../src/lib/llm/base.ts'),
    anthropic: load('../src/lib/llm/anthropic.ts'),
    google: load('../src/lib/llm/google.ts'),
    deepseek: load('../src/lib/llm/deepseek.ts')
  };
}

test('extractModelIds parses OpenAI data, Ollama models, plain arrays, deduplicates and sorts', () => {
  const { base } = loadLlmModules(async () => {
    throw new Error('fetch should not be called');
  });

  assert.deepEqual(
    Array.from(
      base.extractModelIds({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: ' ' }] })
    ),
    ['gpt-4o', 'gpt-4o-mini']
  );
  assert.deepEqual(Array.from(base.extractModelIds({ models: [{ name: 'qwen3:8b' }, { name: 'gemma4:e4b' }] })), [
    'gemma4:e4b',
    'qwen3:8b'
  ]);
  assert.deepEqual(Array.from(base.extractModelIds(['b-model', 'a-model'])), ['a-model', 'b-model']);
  assert.deepEqual(Array.from(base.extractModelIds({ data: [] })), []);
});

test('listModels sends provider-specific headers, normalizes Gemini model IDs, and enforces timeout/abort', async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('anthropic.com')) {
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-3-5-haiku' }] })
      };
    }
    if (url.includes('googleapis.com')) {
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'models/gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }] })
      };
    }
    if (url.includes('deepseek.com')) {
      return await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    return { ok: false, status: 500, text: async () => 'server error' };
  };

  const { anthropic, google, deepseek } = loadLlmModules(fetchMock);

  const anthropicClient = new anthropic.AnthropicClient();
  const anthropicModels = await anthropicClient.listModels();
  assert.deepEqual(Array.from(anthropicModels), ['claude-3-5-haiku', 'claude-sonnet-4-5']);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');

  const geminiClient = new google.GeminiClient();
  const geminiModels = await geminiClient.listModels();
  assert.deepEqual(Array.from(geminiModels), ['gemini-2.5-flash', 'gemini-2.5-pro']);

  // Timeout raises TimeoutError cleanly.
  const dsClient = new deepseek.DeepSeekClient();
  await assert.rejects(
    () => dsClient.listModels({ timeoutMs: 25 }),
    (error) => error?.name === 'TimeoutError'
  );

  // External abort raises AbortError cleanly.
  const external = new AbortController();
  const pending = dsClient.listModels({ signal: external.signal, timeoutMs: 5000 });
  external.abort();
  await assert.rejects(
    () => pending,
    (error) => error?.name === 'AbortError'
  );
});
