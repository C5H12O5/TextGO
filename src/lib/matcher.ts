import { predict } from '$lib/classifier';
import { MODEL_MARK, REGEXP_MARK } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { models, regexps } from '$lib/stores.svelte';
import type { Model, Option, Rule } from '$lib/types';
import { ModelOperations, type ModelResult } from '@vscode/vscode-languagedetection';
import { memoize } from 'es-toolkit/function';
import { franc } from 'franc-min';
import {
  CalendarDots,
  Clock,
  Envelope,
  Folder,
  Globe,
  GlobeSimple,
  Key,
  Link,
  Magnet,
  NumberCircleNine,
  TextAa,
  TextT
} from 'phosphor-svelte';

/**
 * General recognition options.
 */
export const GENERAL_CASES: Option[] = [
  {
    value: 'small_letters',
    label: m.small_letters(),
    icon: TextT,
    pattern: /^(?=.*[a-z])[a-z0-9_\W]+$/
  },
  {
    value: 'capital_letters',
    label: m.capital_letters(),
    icon: TextT,
    pattern: /^(?=.*[A-Z])[A-Z0-9_\W]+$/
  },
  {
    value: 'uuid',
    label: m.uuid(),
    icon: Key,
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  },
  {
    value: 'guid',
    label: m.guid(),
    icon: Key,
    pattern: /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i
  },
  {
    value: 'numbers',
    label: m.numbers(),
    icon: NumberCircleNine,
    pattern: /^[0-9]+$/
  },
  {
    value: 'url',
    label: m.url(),
    icon: Link,
    pattern: /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*$/
  },
  {
    value: 'email',
    label: m.email(),
    icon: Envelope,
    pattern:
      /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
  },
  {
    value: 'path',
    label: m.path(),
    icon: Folder,
    pattern: /^(?:[a-zA-Z]:\\[^<>:"|?*\n\r/]+(?:\\[^<>:"|?*\n\r/]+)*|~?\/[^<>:"|?*\n\r\\]+(?:\/[^<>:"|?*\n\r\\]+)*)$/
  },
  {
    value: 'ipv4',
    label: m.ipv4(),
    icon: GlobeSimple,
    pattern:
      /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  },
  {
    value: 'ipv6',
    label: m.ipv6(),
    icon: Globe,
    pattern:
      /^(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|:(?:(?::[0-9a-f]{1,4}){1,7}|:)|fe80:(?::[0-9a-f]{0,4}){0,4}%[0-9a-z]+|::(?:ffff(?::0{1,4})?:)?(?:(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])\.){3}(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])|(?:[0-9a-f]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])\.){3}(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9]))$/i
  },
  {
    value: 'info_hash',
    label: m.info_hash(),
    icon: Magnet,
    pattern: /^(?:[0-9a-zA-Z]{32}|[0-9a-fA-F]{40}|1220[0-9a-fA-F]{64})$/
  },
  {
    value: 'iso8601',
    label: m.iso8601(),
    icon: CalendarDots,
    pattern:
      /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[+-](?:[01]\d|2[0-3]):[0-5]\d|Z)?$/
  },
  {
    value: 'timestamp',
    label: m.timestamp(),
    icon: Clock,
    // 10-digit second-level or 13-digit millisecond-level Unix timestamp between 2001 and 2286
    pattern: /^(?:[1-9]\d{9}|[1-9]\d{12})$/
  }
];

/**
 * Naming convention recognition options.
 */
export const TEXT_CASES: Option[] = [
  {
    value: 'camel_case',
    label: m.camel_case(),
    icon: TextAa,
    pattern: /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/
  },
  {
    value: 'pascal_case',
    label: m.pascal_case(),
    icon: TextAa,
    pattern: /^[A-Z]+[a-z0-9]+(?:[A-Z][a-z0-9]*)+$|^[A-Z]{2,}[a-z0-9]+$/
  },
  {
    value: 'snake_case',
    label: m.snake_case(),
    icon: TextAa,
    pattern: /^[a-z0-9]+(?:_[a-z0-9]+)+$/
  },
  {
    value: 'kebab_case',
    label: m.kebab_case(),
    icon: TextAa,
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)+$/
  },
  {
    value: 'start_case',
    label: m.start_case(),
    icon: TextAa,
    pattern: /^[A-Z][a-z0-9]*(?: [A-Z][a-z0-9]+)+$/
  },
  {
    value: 'lower_case',
    label: m.lower_case(),
    icon: TextAa,
    pattern: /^(?=.*[a-z])[a-z0-9]+(?: [a-z0-9]+)*$/
  },
  {
    value: 'upper_case',
    label: m.upper_case(),
    icon: TextAa,
    pattern: /^(?=.*[A-Z])[A-Z0-9]+(?: [A-Z0-9]+)*$/
  },
  {
    value: 'constant_case',
    label: m.constant_case(),
    icon: TextAa,
    pattern: /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/
  }
];

/**
 * Natural language recognition options.
 */
export const NATURAL_CASES: Option[] = [
  { value: 'cmn', label: m.lang_cmn() },
  { value: 'eng', label: m.lang_eng() },
  { value: 'jpn', label: m.lang_jpn() },
  { value: 'kor', label: m.lang_kor() },
  { value: 'rus', label: m.lang_rus() },
  { value: 'fra', label: m.lang_fra() },
  { value: 'deu', label: m.lang_deu() },
  { value: 'spa', label: m.lang_spa() },
  { value: 'por', label: m.lang_por() },
  { value: 'arb', label: m.lang_arb() }
];

/**
 * Programming language recognition options.
 */
export const PROGRAMMING_CASES: Option[] = [
  { value: 'asm', label: 'Assembly' },
  { value: 'bat', label: 'Batchfile' },
  { value: 'c', label: 'C' },
  { value: 'cs', label: 'C#' },
  { value: 'cpp', label: 'C++' },
  { value: 'clj', label: 'Clojure' },
  { value: 'cmake', label: 'CMake' },
  { value: 'cbl', label: 'COBOL' },
  { value: 'coffee', label: 'CoffeeScript' },
  { value: 'css', label: 'CSS' },
  { value: 'csv', label: 'CSV' },
  { value: 'dart', label: 'Dart' },
  { value: 'dm', label: 'DM' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'ex', label: 'Elixir' },
  { value: 'erl', label: 'Erlang' },
  { value: 'f90', label: 'Fortran' },
  { value: 'go', label: 'Go' },
  { value: 'groovy', label: 'Groovy' },
  { value: 'hs', label: 'Haskell' },
  { value: 'html', label: 'HTML' },
  { value: 'ini', label: 'INI' },
  { value: 'java', label: 'Java' },
  { value: 'js', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'jl', label: 'Julia' },
  { value: 'kt', label: 'Kotlin' },
  { value: 'lisp', label: 'Lisp' },
  { value: 'lua', label: 'Lua' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'md', label: 'Markdown' },
  { value: 'matlab', label: 'Matlab' },
  { value: 'mm', label: 'Objective-C' },
  { value: 'ml', label: 'OCaml' },
  { value: 'pas', label: 'Pascal' },
  { value: 'pm', label: 'Perl' },
  { value: 'php', label: 'PHP' },
  { value: 'ps1', label: 'PowerShell' },
  { value: 'prolog', label: 'Prolog' },
  { value: 'py', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'rb', label: 'Ruby' },
  { value: 'rs', label: 'Rust' },
  { value: 'scala', label: 'Scala' },
  { value: 'sh', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'tex', label: 'TeX' },
  { value: 'toml', label: 'TOML' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'v', label: 'Verilog' },
  { value: 'vba', label: 'Visual Basic' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' }
];

// natural language detection options for franc
const FRANC_OPTIONS = { minLength: 2, only: NATURAL_CASES.map((c) => c.value as string) };

// create programming language recognition model instance
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

// minimum expected confidence
const MIN_CONFIDENCE = 0.2;

// initial confidence threshold
const INITIAL_THRESHOLD = 0.5;

// relative confidence difference threshold
const RELATIVE_THRESHOLD = 0.15;

// memoized lookup function
const findBuiltinCase = memoize((_case: string) => [...GENERAL_CASES, ...TEXT_CASES].find((c) => c.value === _case));
const findNaturalCase = memoize((_case: string) => NATURAL_CASES.find((c) => c.value === _case));
const findProgrammingCase = memoize((_case: string) => PROGRAMMING_CASES.find((c) => c.value === _case));

/**
 * Find the first matching rule for the given text.
 *
 * @param text - text to match
 * @param rules - list of rules to check
 * @returns the first matched rule object, or null if no match is found
 */
export async function matchOne(text: string, rules: Rule[]): Promise<Rule | null> {
  return (await match(text, rules, false)) as Rule | null;
}

/**
 * Find all matching rules for the given text.
 *
 * @param text - text to match
 * @param rules - list of rules to check
 * @returns array of matched rule objects
 */
export async function matchAll(text: string, rules: Rule[]): Promise<Rule[]> {
  return (await match(text, rules, true)) as Rule[];
}

/**
 * Match the shortcut action to be executed based on the text type.
 *
 * @param text - text to match
 * @param rules - list of specified rules
 * @param matchAll - whether to find all matched rules
 * @returns the matched rule(s), returns `null` or empty array if no match is found
 */
async function match(text: string, rules: Rule[], matchAll: boolean): Promise<Rule | Rule[] | null> {
  console.debug(`Matching patterns: ${rules.map((r) => r.case || 'skip').join(', ')}`);
  const matchedRules: Rule[] = [];
  const matchedLangs: ModelResult[] = [];

  // iterate through all bound rules to find the matching text type(s)
  for (const rule of rules) {
    let matched: Rule | null = null;
    const _case: string = rule.case;

    // empty string means no recognition
    if (_case === '') {
      console.debug('Skipping text recognition');
      matched = { ...rule };
    }

    if (text) {
      // builtin regular expression matching
      if (!matched) {
        const builtin = findBuiltinCase(_case);
        if (builtin && builtin.pattern && builtin.pattern.test(text)) {
          console.debug(`Builtin regex matched: ${builtin.label}`);
          matched = { ...rule, caseLabel: builtin.label };
        }
      }

      // natural language detection
      if (!matched) {
        const natural = findNaturalCase(_case);
        if (natural) {
          try {
            if (franc(text, FRANC_OPTIONS) === _case) {
              console.debug(`Natural language detected: ${natural.label}`);
              matched = { ...rule, caseLabel: natural.label };
            }
          } catch (error) {
            console.error(`Natural language detection failed: ${error}`);
          }
        }
      }

      // programming language detection
      if (!matched) {
        const programming = findProgrammingCase(_case);
        if (programming) {
          try {
            if (matchedLangs.length === 0) {
              matchedLangs.push(...(await MODEL_OPERATIONS.runModel(text)));
              console.debug(`Programming language detection result: ${JSON.stringify(matchedLangs)}`);
            }
            if (matchProgrammingCase(_case, matchedLangs)) {
              console.debug(`Programming language detected: ${programming.label}`);
              matched = { ...rule, caseLabel: programming.label };
            }
          } catch (error) {
            console.error(`Programming language detection failed: ${error}`);
          }
        }
      }

      // custom regular expression matching
      if (!matched && _case.startsWith(REGEXP_MARK)) {
        const regexpId = _case.substring(REGEXP_MARK.length);
        const regexp = regexps.current.find((r) => r.id === regexpId);
        if (regexp && regexp.pattern) {
          try {
            const pattern = new RegExp(regexp.pattern, regexp.flags);
            if (pattern.test(text)) {
              console.debug(`Custom regex matched: ${regexp.id}`);
              matched = { ...rule, caseLabel: regexp.id };
            }
          } catch (error) {
            console.error(`Custom regex matching failed: ${error}`);
          }
        }
      }

      // custom model detection
      if (!matched && _case.startsWith(MODEL_MARK)) {
        const modelId = _case.substring(MODEL_MARK.length);
        const model = models.current.find((m) => m.id === modelId);
        if (model) {
          try {
            if (await matchModelCase(model, text)) {
              console.debug(`Custom model matched: ${model.id}`);
              matched = { ...rule, caseLabel: model.id };
            }
          } catch (error) {
            console.error(`Custom model matching failed: ${error}`);
          }
        }
      }
    }

    if (matched) {
      if (matchAll) {
        matchedRules.push(matched);
      } else {
        return matched;
      }
    }
  }

  return matchAll ? matchedRules : null;
}

/**
 * Determine if the programming language detection result matches the target language.
 * Referenced VS Code's recognition strategy, using dynamic threshold and confidence difference from adjacent positions to judge.
 *
 * https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/languageDetection/browser/languageDetectionWebWorker.ts
 *
 * @param targetId - target language ID
 * @param results - model recognition results
 * @returns whether it matches the target language
 */
function matchProgrammingCase(targetId: string, results: ModelResult[]): boolean {
  if (!results || results.length === 0) {
    return false;
  }
  // get the position and confidence of target language in model recognition results
  const targetIndex = results.findIndex((result) => result.languageId === targetId);
  if (targetIndex === -1) {
    // target language is not in the results
    return false;
  }
  const targetConfidence = results[targetIndex].confidence;

  // strategy 1: judge if the confidence of target language meets the threshold
  const threshold = INITIAL_THRESHOLD + 0.1 * targetIndex;
  if (targetConfidence > threshold) {
    return true;
  }

  // strategy 2: judge if the confidence difference from adjacent positions meets the threshold
  if (targetConfidence <= MIN_CONFIDENCE || targetIndex >= 3) {
    // confidence is too low or ranking is too low
    return false;
  }
  const nextConfidence = results[targetIndex + 1]?.confidence ?? 0;
  return targetConfidence - nextConfidence > RELATIVE_THRESHOLD;
}

/**
 * Determine if the selected text matches the custom model.
 *
 * @param model - custom model
 * @param text - text to match
 * @returns
 */
async function matchModelCase(model: Model, text: string): Promise<boolean> {
  if (!model || !model.modelTrained) {
    return false;
  }
  // load trained model for matching
  const confidence = await predict(model.id, text);
  return confidence !== null && confidence >= model.threshold;
}
