import { fetch } from '@tauri-apps/plugin-http';
import * as _ from 'es-toolkit';

/**
 * Evaluate synchronous JavaScript code.
 *
 * @param data - input data
 * @param code - user code
 * @returns evaluation result
 */
export function evalSync(data: Record<string, string>, code: string): string {
  const wrappedCode = `
    (function() {
      const data = ${JSON.stringify(data)};
      ${code}
      const result = process(data);
      return typeof result === 'string' ? result : JSON.stringify(result);
    })()
  `;
  return eval(wrappedCode);
}

/**
 * Evaluate asynchronous JavaScript code.
 *
 * @param data - input data
 * @param code - user code
 * @returns evaluation result
 */
export async function evalAsync(data: Record<string, string>, code: string): Promise<string> {
  const wrappedCode = `
    (async function() {
      const data = ${JSON.stringify(data)};
      ${code}
      const result = await process(data);
      return typeof result === 'string' ? result : JSON.stringify(result);
    })()
  `;
  return await eval(wrappedCode);
}

// prevent tree-shaking and unused variable errors
/* eslint-disable @typescript-eslint/no-explicit-any */
(window as any)._fetch = fetch;
(window as any)._ = _;
