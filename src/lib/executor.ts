import { PROMPT_MARK, SCRIPT_MARK, SEARCHER_MARK } from '$lib/constants';
import { isMouseShortcut } from '$lib/helpers';
import { m } from '$lib/paraglide/messages';
import { entries, historySize, nodePath, prompts, pythonPath, scripts, searchers } from '$lib/stores.svelte';
import type { Entry, Processor, Prompt, Rule, Script } from '$lib/types';
import { invoke } from '@tauri-apps/api/core';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { memoize } from 'es-toolkit/function';
import {
  camelCase,
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
import { ArrowsClockwise, Browsers, CopySimple, FolderOpen, Function } from 'phosphor-svelte';

/**
 * Executor context to pass to executors.
 */
interface ExecutorContext {
  /** Action ID. */
  action: string;
  /** Current datetime. */
  datetime: string;
  /** Clipboard text. */
  clipboard: string;
  /** Selected text. */
  selection: string;
  /** History record. */
  entry: Entry;
}

/**
 * Executor function type.
 * Returns true if the action was handled, false otherwise.
 */
type Executor = (context: ExecutorContext) => Promise<boolean>;

/**
 * Result type of script execution.
 */
type Result = {
  text: string;
  error?: boolean;
};

// regular expressions to match URLs and file paths
const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/gm;
const PATH_REGEX =
  /(?:[a-zA-Z]:\\[^<>:"|?*\n\r/]+(?:\\[^<>:"|?*\n\r/]+)*|~?\/[^<>:"|?*\n\r\\]+(?:\/[^<>:"|?*\n\r\\]+)*)/gm;

/**
 * Default actions.
 */
export const DEFAULT_ACTIONS: Processor[] = [
  {
    value: 'copy',
    label: m.copy(),
    icon: CopySimple,
    process: (text: string) => {
      if (text) {
        invoke('set_clipboard_text', { text });
      }
      return '';
    },
    builtIn: true,
    noResult: true
  }
];

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
    },
    builtIn: true,
    noResult: true
  },
  {
    value: 'open_paths',
    label: m.open_paths(),
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
    },
    builtIn: true,
    noResult: true
  }
];

/**
 * Naming convention conversion actions.
 */
export const CONVERT_ACTIONS: Processor[] = [
  {
    value: 'camel_case',
    label: m.camel_case(),
    process: camelCase
  },
  {
    value: 'pascal_case',
    label: m.pascal_case(),
    process: pascalCase
  },
  {
    value: 'lower_case',
    label: m.lower_case(),
    process: lowerCase
  },
  {
    value: 'start_case',
    label: m.start_case(),
    process: startCase
  },
  {
    value: 'upper_case',
    label: m.upper_case(),
    process: upperCase
  },
  {
    value: 'snake_case',
    label: m.snake_case(),
    process: snakeCase
  },
  {
    value: 'kebab_case',
    label: m.kebab_case(),
    process: kebabCase
  },
  {
    value: 'constant_case',
    label: m.constant_case(),
    process: constantCase
  }
].map((a) => ({ ...a, icon: ArrowsClockwise, builtIn: true }));

/**
 * Text processing actions.
 */
export const PROCESS_ACTIONS: Processor[] = [
  {
    value: 'words',
    label: m.words(),
    process: (text: string) => words(text).join(' ')
  },
  {
    value: 'reverse',
    label: m.reverse(),
    process: reverseString
  },
  {
    value: 'trim',
    label: m.trim(),
    process: trim
  },
  {
    value: 'ltrim',
    label: m.ltrim(),
    process: trimStart
  },
  {
    value: 'rtrim',
    label: m.rtrim(),
    process: trimEnd
  },
  {
    value: 'deburr',
    label: m.deburr(),
    process: deburr
  },
  {
    value: 'escape',
    label: m.escape(),
    process: escape
  },
  {
    value: 'unescape',
    label: m.unescape(),
    process: unescape
  }
].map((a) => ({ ...a, icon: Function, builtIn: true }));

// memoized lookup function
const findBuiltinAction = memoize((action: string) =>
  [...DEFAULT_ACTIONS, ...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find((a) => a.value === action)
);

/**
 * Default executor - shows main window when no action is specified.
 */
const defaultExecutor: Executor = async (context) => {
  const { action } = context;
  if (action === '') {
    await invoke('show_main_window');
    return true;
  }
  return false;
};

/**
 * Script executor - executes user-defined scripts.
 */
const scriptExecutor: Executor = async (context) => {
  const { action, entry } = context;
  if (!action.startsWith(SCRIPT_MARK)) {
    return false;
  }

  const scriptId = action.substring(SCRIPT_MARK.length);
  const script = scripts.current.find((s) => s.id === scriptId);
  if (script) {
    console.debug(`Executing script: ${scriptId}`);
    const result = await executeScript(script, context);
    // save history record
    entry.actionType = 'script';
    entry.actionLabel = scriptId;
    entry.result = result.text;
    entry.scriptLang = script.lang;
    saveEntry(entry);
    // directly replace selected text
    if (!result.error) {
      await invoke('enter_text', result);
    }
  }

  return true;
};

/**
 * Prompt executor - generates AI prompts and shows popup window.
 */
const promptExecutor: Executor = async (context) => {
  const { action, entry } = context;
  if (!action.startsWith(PROMPT_MARK)) {
    return false;
  }

  const promptId = action.substring(PROMPT_MARK.length);
  const prompt = prompts.current.find((p) => p.id === promptId);
  if (prompt) {
    console.debug(`Generating prompt: ${promptId}`);
    const result = renderPrompt(prompt, context);
    // save history record
    entry.actionType = 'prompt';
    entry.actionLabel = promptId;
    entry.result = result;
    entry.systemPrompt = prompt.systemPrompt;
    entry.provider = prompt.provider;
    entry.model = prompt.model;
    saveEntry(entry);
    // show popup window
    await showPopup(entry);
  }

  return true;
};

/**
 * Searcher executor - opens search URLs in specified browser.
 */
const searcherExecutor: Executor = async (context) => {
  const { action, selection, entry } = context;
  if (!action.startsWith(SEARCHER_MARK)) {
    return false;
  }

  const searcherId = action.substring(SEARCHER_MARK.length);
  const searcher = searchers.current.find((s) => s.id === searcherId);
  if (searcher) {
    console.debug(`Opening URL for searcher: ${searcherId}`);
    // replace {{selection}} in URL template with trimmed selection
    const result = searcher.url.replace(/\{\{selection\}\}/g, selection.trim());
    // save history record
    entry.actionType = 'searcher';
    entry.actionLabel = searcherId;
    entry.result = result;
    saveEntry(entry);
    // open URL
    await openUrl(result, searcher.browser);
  }

  return true;
};

/**
 * Builtin executor - executes built-in text processing actions.
 */
const builtinExecutor: Executor = async (context) => {
  const { action, selection } = context;
  const builtin = findBuiltinAction(action);
  if (!builtin) {
    return false;
  }

  console.debug(`Executing builtin action: ${action}`);
  const result = builtin.process(selection);
  // directly replace selected text
  await invoke('enter_text', { text: result });

  return true;
};

/**
 * Chain of executors to try.
 */
const EXECUTORS: Executor[] = [defaultExecutor, scriptExecutor, promptExecutor, searcherExecutor, builtinExecutor];

/**
 * Execute action.
 *
 * @param rule - rule object
 * @param selection - selected text
 */
export async function execute(rule: Rule, selection: string): Promise<void> {
  const datetime = new Date().toISOString();
  const clipboard = await invoke<string>('get_clipboard_text');

  // generate record
  const entry: Entry = {
    id: crypto.randomUUID(),
    shortcut: rule.shortcut,
    caseLabel: rule.caseLabel,
    datetime: datetime,
    clipboard: clipboard,
    selection: selection
  };

  // create context
  const context: ExecutorContext = {
    action: rule.action,
    datetime: datetime,
    clipboard: clipboard,
    selection: selection,
    entry: entry
  };

  // execute executors in chain until one succeeds
  for (const executor of EXECUTORS) {
    const handled = await executor(context);
    if (handled) break;
  }
}

/**
 * Execute input script and return result.
 *
 * @param script - script object
 * @param context - executor context
 * @returns script execution result
 */
async function executeScript(script: Script, context: ExecutorContext): Promise<Result> {
  try {
    const data = {
      datetime: context.datetime,
      clipboard: context.clipboard,
      selection: context.selection
    };
    if (script.lang === 'javascript') {
      const result = await invoke<string>('execute_javascript', {
        code: script.script,
        data: JSON.stringify(data),
        nodePath: nodePath.current
      });
      return { text: result };
    } else if (script.lang === 'python') {
      const result = await invoke<string>('execute_python', {
        code: script.script,
        data: JSON.stringify(data),
        pythonPath: pythonPath.current
      });
      return { text: result };
    } else {
      throw new Error(`unsupported script language: ${script.lang}`);
    }
  } catch (error) {
    return { text: String(error), error: true };
  }
}

/**
 * Render the input prompt and return the result.
 *
 * @param prompt - prompt object
 * @param context - executor context
 * @returns rendering result
 */
function renderPrompt(prompt: Prompt, context: ExecutorContext): string {
  let result = prompt.prompt || '';

  // use regular expression to replace template parameters
  result = result.replace(/\{\{clipboard\}\}/g, context.clipboard);
  result = result.replace(/\{\{selection\}\}/g, context.selection);
  result = result.replace(/\{\{datetime\}\}/g, context.datetime);

  return result;
}

/**
 * Save entry to history.
 *
 * @param entry - record object to save
 */
function saveEntry(entry: Entry): void {
  entries.current.unshift(entry);
  // remove excess records
  if (entries.current.length > historySize.current) {
    entries.current = entries.current.slice(0, historySize.current);
  }
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
