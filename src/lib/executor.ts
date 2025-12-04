import { PROMPT_MARK, SCRIPT_MARK } from '$lib/constants';
import { isMouseShortcut } from '$lib/helpers';
import { m } from '$lib/paraglide/messages';
import { entries, historySize, nodePath, prompts, pythonPath, scripts } from '$lib/stores.svelte';
import type { Entry, Option, Prompt, Rule, Script } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { memoize } from 'es-toolkit/function';
import {
  camelCase,
  capitalize,
  constantCase,
  deburr,
  escape,
  kebabCase,
  lowerCase,
  pascalCase,
  reverseString,
  snakeCase,
  startCase,
  trim,
  trimEnd,
  trimStart,
  unescape,
  upperCase,
  words
} from 'es-toolkit/string';
import { Browsers, FolderOpen, Function, TextAa } from 'phosphor-svelte';

const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/gm;
const PATH_REGEX =
  /(?:[a-zA-Z]:\\[^<>:"|?*\n\r/]+(?:\\[^<>:"|?*\n\r/]+)*|~?\/[^<>:"|?*\n\r\\]+(?:\/[^<>:"|?*\n\r\\]+)*)/gm;

/**
 * Type of data passed to scripts and prompts.
 */
type Data = {
  /** Selected text. */
  selection: string;
  /** Clipboard text. */
  clipboard: string;
  /** Current datetime. */
  datetime: string;
};

/**
 * Built-in action type.
 */
type Processor = Option & {
  process: (selection: string) => string;
};

/**
 * General actions.
 */
export const GENERAL_ACTIONS: Processor[] = [
  {
    value: 'open_urls',
    label: m.open_urls(),
    icon: Browsers,
    process: (text: string) => {
      // extract all URLs in text
      const urls = text.match(URL_REGEX) || [];
      // open each URL
      urls.forEach((url) => {
        openUrl(url).catch((error) => {
          console.error(`Failed to open URL ${url}: ${error}`);
        });
      });
      return '';
    }
  },
  {
    value: 'open_files',
    label: m.open_files(),
    icon: FolderOpen,
    process: (text: string) => {
      // extract all file paths in text
      const paths = text.match(PATH_REGEX) || [];
      // open each file path
      paths.forEach((path) => {
        openPath(path).catch((error) => {
          console.error(`Failed to open path ${path}: ${error}`);
        });
      });
      return '';
    }
  }
];

/**
 * Naming convention conversion actions.
 */
export const CONVERT_ACTIONS: Processor[] = [
  {
    value: 'camel_case',
    label: m.camel_case(),
    icon: TextAa,
    process: camelCase
  },
  {
    value: 'pascal_case',
    label: m.pascal_case(),
    icon: TextAa,
    process: pascalCase
  },
  {
    value: 'snake_case',
    label: m.snake_case(),
    icon: TextAa,
    process: snakeCase
  },
  {
    value: 'kebab_case',
    label: m.kebab_case(),
    icon: TextAa,
    process: kebabCase
  },
  {
    value: 'start_case',
    label: m.start_case(),
    icon: TextAa,
    process: startCase
  },
  {
    value: 'lower_case',
    label: m.lower_case(),
    icon: TextAa,
    process: lowerCase
  },
  {
    value: 'upper_case',
    label: m.upper_case(),
    icon: TextAa,
    process: upperCase
  },
  {
    value: 'constant_case',
    label: m.constant_case(),
    icon: TextAa,
    process: constantCase
  }
];

/**
 * Text processing actions.
 */
export const PROCESS_ACTIONS: Processor[] = [
  {
    value: 'lowercase',
    label: m.lowercase(),
    icon: Function,
    process: (text: string) => text.toLowerCase()
  },
  {
    value: 'uppercase',
    label: m.uppercase(),
    icon: Function,
    process: (text: string) => text.toUpperCase()
  },
  {
    value: 'capitalize',
    label: m.capitalize(),
    icon: Function,
    process: capitalize
  },
  {
    value: 'trim',
    label: m.trim(),
    icon: Function,
    process: trim
  },
  {
    value: 'ltrim',
    label: m.ltrim(),
    icon: Function,
    process: trimStart
  },
  {
    value: 'rtrim',
    label: m.rtrim(),
    icon: Function,
    process: trimEnd
  },
  {
    value: 'deburr',
    label: m.deburr(),
    icon: Function,
    process: deburr
  },
  {
    value: 'escape',
    label: m.escape(),
    icon: Function,
    process: escape
  },
  {
    value: 'unescape',
    label: m.unescape(),
    icon: Function,
    process: unescape
  },
  {
    value: 'reverse',
    label: m.reverse(),
    icon: Function,
    process: reverseString
  },
  {
    value: 'words',
    label: m.words(),
    icon: Function,
    process: (text: string) => words(text).join(' ')
  }
];

// memoized lookup function
const findBuiltinAction = memoize((action: string) =>
  [...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find((a) => a.value === action)
);

/**
 * Execute action.
 *
 * @param rule - rule object
 * @param selection - selected text
 */
export async function execute(rule: Rule, selection: string): Promise<void> {
  // action identifier
  const action = rule.action;

  // execute default action
  if (action === '') {
    await invoke('show_main_window');
    return;
  }

  // assemble data
  const data: Data = {
    selection: selection,
    clipboard: await invoke<string>('get_clipboard_text'),
    datetime: new Date().toISOString()
  };

  // generate record
  const entry: Entry = {
    id: crypto.randomUUID(),
    shortcut: rule.shortcut,
    caseLabel: rule.caseLabel,
    // actionLabel: rule.actionLabel,
    datetime: data.datetime,
    clipboard: data.clipboard,
    selection: data.selection
  };

  // execute action based on identifier
  if (action.startsWith(SCRIPT_MARK)) {
    const scriptId = action.substring(SCRIPT_MARK.length);
    const script = scripts.current.find((s) => s.id === scriptId);
    if (script) {
      console.debug(`Executing script: ${scriptId}`);
      const result = await executeScript(script, data);
      console.debug(`Script executed successfully: ${result}`);
      // save record
      entry.actionType = 'script';
      entry.actionLabel = scriptId;
      entry.result = result;
      entry.scriptLang = script.lang;
      entries.current.unshift(entry);
      // remove excess records
      if (entries.current.length > historySize.current) {
        entries.current = entries.current.slice(0, historySize.current);
      }
      // directly replace selected text
      await invoke('enter_text', { text: result });
    }
  } else if (action.startsWith(PROMPT_MARK)) {
    const promptId = action.substring(PROMPT_MARK.length);
    const prompt = prompts.current.find((p) => p.id === promptId);
    if (prompt) {
      console.debug(`Generating prompt: ${promptId}`);
      const result = await renderPrompt(prompt, data);
      console.debug(`Prompt generated successfully: ${result}`);
      // save record
      entry.actionType = 'prompt';
      entry.actionLabel = promptId;
      entry.result = result;
      entry.systemPrompt = prompt.systemPrompt;
      entry.provider = prompt.provider;
      entry.model = prompt.model;
      entries.current.unshift(entry);
      // remove excess records
      if (entries.current.length > historySize.current) {
        entries.current = entries.current.slice(0, historySize.current);
      }
      // show popup window
      await showPopup(entry);
    }
  } else {
    const builtin = findBuiltinAction(action);
    if (builtin) {
      console.debug(`Executing builtin action: ${action}`);
      const result = builtin.process(selection);
      console.debug(`Builtin action executed successfully: ${result}`);
      await invoke('enter_text', { text: result });
    }
  }
}

/**
 * Execute input script and return result.
 *
 * @param script - script object
 * @param data - data object
 * @returns script execution result
 */
export async function executeScript(script: Script, data: Data): Promise<string> {
  try {
    if (script.lang === 'javascript') {
      const result = await invoke<string>('execute_javascript', {
        code: script.script,
        data: JSON.stringify(data),
        nodePath: nodePath.current
      });
      return result;
    } else if (script.lang === 'python') {
      const result = await invoke<string>('execute_python', {
        code: script.script,
        data: JSON.stringify(data),
        pythonPath: pythonPath.current
      });
      return result;
    } else {
      throw new Error(`unsupported script language: ${script.lang}`);
    }
  } catch (error) {
    console.error(`Script execution failed: ${error}`);
    throw error;
  }
}

/**
 * Render the input prompt and return the result.
 *
 * @param prompt - prompt object
 * @param data - data object
 * @returns rendering result
 */
export async function renderPrompt(prompt: Prompt, data: Data): Promise<string> {
  let result = prompt.prompt || '';

  // use regular expression to replace template parameters
  result = result.replace(/\{\{clipboard\}\}/g, data.clipboard);
  result = result.replace(/\{\{selection\}\}/g, data.selection);
  result = result.replace(/\{\{datetime\}\}/g, data.datetime);

  return result;
}

/**
 * Show popup window.
 *
 * @param entry - record object to display
 */
async function showPopup(entry: Entry): Promise<void> {
  try {
    await invoke('show_popup', {
      payload: JSON.stringify(entry),
      mouse: isMouseShortcut(entry.shortcut)
    });
  } catch (error) {
    console.error(`Failed to show popup window: ${error}`);
  }
}
