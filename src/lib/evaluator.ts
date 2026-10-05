import type { PredicateData } from '$lib/types';
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
 * Evaluate JavaScript in the WebView, preserving its return type.
 *
 * @param data - input data
 * @param code - user code
 * @param functionName - entry point for action scripts or predicates
 * @returns evaluation result
 */
async function evaluate(
  data: Record<string, string>,
  code: string,
  functionName: 'process' | 'matches' = 'process'
): Promise<unknown> {
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
        result = await ${functionName}(data);
      } finally {
        await keyboardQueue;
      }
      if (keyboardErrors.length) {
        throw keyboardErrors[0];
      }
      return result;
    })()
  `;
  return await eval(wrappedCode);
}

/**
 * Evaluate an action script with the existing text output protocol.
 */
export async function evaluateAction(data: Record<string, string>, code: string): Promise<string> {
  const result = await evaluate(data, code);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

/**
 * Evaluate matches(data) with the selection and source application ID in the WebView.
 * Non-boolean results and script errors reject the promise.
 */
export async function evaluatePredicate(data: PredicateData, code: string): Promise<boolean> {
  const result = await evaluate(data, code, 'matches');
  if (typeof result !== 'boolean') {
    throw new TypeError('Predicates must return true or false');
  }
  return result;
}

// prevent tree-shaking and unused variable errors
/* eslint-disable @typescript-eslint/no-explicit-any */
(window as any)._fetch = fetch;
(window as any)._ = _;
(window as any)._keyboard = Object.freeze({ press: sendKey });
