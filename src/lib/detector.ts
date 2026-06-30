import { ModelOperations, type ModelResult } from '@vscode/vscode-languagedetection';
import vscodeLanguageDetectionCpuChunk from '@vscode/vscode-languagedetection/dist/lib/979.js';

export type ProgrammingLanguageResult = ModelResult;

const REQUIRE_SHIM_MARK = '__textgoVscodeLanguageDetectionShim';

type LanguageDetectionRequire = ((id: string) => unknown) & Partial<Record<typeof REQUIRE_SHIM_MARK, true>>;
type GlobalWithRequire = typeof globalThis & { require?: LanguageDetectionRequire };

function ensureLanguageDetectionRequire() {
  const target = globalThis as GlobalWithRequire;
  const currentRequire = target.require;

  if (currentRequire?.[REQUIRE_SHIM_MARK]) {
    return;
  }

  const shim = ((id: string) => {
    if (id === './979.js') {
      return vscodeLanguageDetectionCpuChunk;
    }
    if (currentRequire) {
      return currentRequire(id);
    }
    throw new Error(`Unsupported CommonJS require in language detector: ${id}`);
  }) as LanguageDetectionRequire;

  Object.defineProperty(shim, REQUIRE_SHIM_MARK, { value: true });
  Object.defineProperty(target, 'require', { value: shim, configurable: true });
}

const MODEL_OPERATIONS = new ModelOperations({
  // custom JSON model loader function
  modelJsonLoaderFunc: async () => {
    try {
      const response = await fetch('/model.json');
      if (!response.ok) {
        throw new Error(`Unable to load model JSON file: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Failed to load model JSON file: ${error}`);
      throw error;
    }
  },
  // custom weights file loader function
  weightsLoaderFunc: async () => {
    try {
      const response = await fetch('/group1-shard1of1.bin');
      if (!response.ok) {
        throw new Error(`Unable to load model weights file: ${response.status}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Failed to load model weights file: ${error}`);
      throw error;
    }
  }
});

export async function detectProgrammingLanguages(text: string): Promise<ProgrammingLanguageResult[]> {
  ensureLanguageDetectionRequire();
  return await MODEL_OPERATIONS.runModel(text);
}
