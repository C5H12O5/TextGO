import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import * as _ from 'es-toolkit';

function sendKey(key: string): Promise<void>;
function sendKey(modifiers: string[], key: string): Promise<void>;
function sendKey(first: string | string[], second?: string): Promise<void> {
  const modifiers = Array.isArray(first) ? first : [];
  const key = Array.isArray(first) ? second : first;
  if (typeof key !== 'string') {
    return Promise.reject(new TypeError('A key is required after the modifiers'));
  }
  return invoke<void>('send_key', { key, modifiers });
}

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
      let keyboardQueue = Promise.resolve();
      const keyboardErrors = [];
      const _keyboard = {
        press: (...args) => {
          const task = keyboardQueue.then(() => window._keyboard.press(...args));
          keyboardQueue = task.catch((error) => {
            keyboardErrors.push(error);
          });
          return task;
        }
      };
      ${code}
      let result;
      try {
        result = await process(data);
      } finally {
        await keyboardQueue;
      }
      if (keyboardErrors.length) {
        throw keyboardErrors[0];
      }
      return typeof result === 'string' ? result : JSON.stringify(result);
    })()
  `;
  return await eval(wrappedCode);
}

// prevent tree-shaking and unused variable errors
/* eslint-disable @typescript-eslint/no-explicit-any */
(window as any)._fetch = fetch;
(window as any)._ = _;
(window as any)._keyboard = Object.freeze({ press: sendKey });
