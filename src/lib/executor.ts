import { PROMPT_MARK, SCRIPT_MARK, SEARCHER_MARK } from '$lib/constants';
import { evalAsync, evalSync } from '$lib/evaluator';
import { isMouseShortcut } from '$lib/helpers';
import { m } from '$lib/paraglide/messages';
import { denoPath, entries, historySize, nodePath, prompts, pythonPath, scripts, searchers } from '$lib/stores.svelte';
import type { Entry, Processor, Prompt, Rule, Script, WindowPlacement } from '$lib/types';
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
import { ArrowsClockwiseIcon, BrowsersIcon, CopySimpleIcon, FolderOpenIcon, FunctionIcon } from 'phosphor-svelte';

/**
 * Executor function type.
 * Returns true if the action was handled, false otherwise.
 */
type Executor = (rule: Rule, entry: Entry, placement?: WindowPlacement) => Promise<boolean | string>;

/**
 * Script execution result type.
 */
type Result = {
  // result text
  text: string;
  // error message
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
    icon: CopySimpleIcon,
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
    icon: BrowsersIcon,
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
    icon: FolderOpenIcon,
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
].map((a) => ({ ...a, icon: ArrowsClockwiseIcon, builtIn: true }));

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
].map((a) => ({ ...a, icon: FunctionIcon, builtIn: true }));

// memoized lookup function
const findBuiltinAction = memoize((action: string) =>
  [...DEFAULT_ACTIONS, ...GENERAL_ACTIONS, ...CONVERT_ACTIONS, ...PROCESS_ACTIONS].find((a) => a.value === action)
);

/**
 * Default executor - shows main window when no action is specified.
 */
const defaultExecutor: Executor = async (rule) => {
  if (rule.action === '') {
    await invoke('show_main_window');
    return true;
  }
  return false;
};

/**
 * Script executor - executes user-defined scripts.
 */
const scriptExecutor: Executor = async (rule, entry, placement) => {
  if (!rule.action.startsWith(SCRIPT_MARK)) {
    return false;
  }

  const scriptId = rule.action.substring(SCRIPT_MARK.length);
  const script = scripts.current.find((s) => s.id === scriptId);
  if (script) {
    console.debug(`Executing script: ${scriptId}`);
    const result = await executeScript(script, entry);
    // save history record
    entry.actionType = 'script';
    entry.actionLabel = scriptId;
    entry.result = result.text;
    entry.scriptLang = script.lang;
    if (rule.history) {
      saveHistory(entry);
    }
    if (!result.error) {
      // return result text in preview mode
      if (rule.preview) {
        return result.text;
      }
      if (rule.outputMode === 'replace') {
        // directly replace selected text
        await invoke('enter_text', {
          text: result.text,
          clipboard: rule.clipboard
        });
      } else if (rule.outputMode === 'popup') {
        // show popup window
        entry.copyOnPopup = rule.clipboard;
        await showPopup(entry, placement);
      }
    }
  }

  return true;
};

/**
 * Prompt executor - generates AI prompts and shows popup window.
 */
const promptExecutor: Executor = async (rule, entry, placement) => {
  if (!rule.action.startsWith(PROMPT_MARK)) {
    return false;
  }

  const promptId = rule.action.substring(PROMPT_MARK.length);
  const prompt = prompts.current.find((p) => p.id === promptId);
  if (prompt) {
    console.debug(`Generating prompt: ${promptId}`);
    const result = renderPrompt(prompt, entry);
    // save history record
    entry.actionType = 'prompt';
    entry.actionLabel = promptId;
    entry.result = result;
    entry.systemPrompt = prompt.systemPrompt;
    entry.provider = prompt.provider;
    entry.model = prompt.model;
    entry.maxTokens = prompt.maxTokens;
    entry.temperature = prompt.temperature;
    entry.topP = prompt.topP;
    if (rule.history) {
      saveHistory(entry);
    }
    // show popup window
    await showPopup(entry, placement);
  }

  return true;
};

/**
 * Searcher executor - opens search URLs in specified browser.
 */
const searcherExecutor: Executor = async (rule, entry) => {
  if (!rule.action.startsWith(SEARCHER_MARK)) {
    return false;
  }

  const searcherId = rule.action.substring(SEARCHER_MARK.length);
  const searcher = searchers.current.find((s) => s.id === searcherId);
  if (searcher) {
    console.debug(`Opening URL for searcher: ${searcherId}`);
    // replace {{selection}} in URL template with trimmed selection
    const result = searcher.url.replace(/\{\{selection\}\}/g, entry.selection.trim());
    // save history record
    entry.actionType = 'searcher';
    entry.actionLabel = searcherId;
    entry.result = result;
    if (rule.history) {
      saveHistory(entry);
    }
    // open URL
    await openUrl(result, searcher.browser);
  }

  return true;
};

/**
 * Builtin executor - executes built-in text processing actions.
 */
const builtinExecutor: Executor = async (rule, entry, placement) => {
  const builtin = findBuiltinAction(rule.action);
  if (!builtin) {
    return false;
  }

  console.debug(`Executing builtin action: ${rule.action}`);
  const result = builtin.process(entry.selection);
  // save history record
  entry.actionType = 'builtin';
  entry.actionLabel = builtin.label;
  entry.result = result;
  if (rule.history) {
    saveHistory(entry);
  }
  // return result text in preview mode
  if (rule.preview) {
    return result;
  }
  if (rule.outputMode === 'replace') {
    // directly replace selected text
    await invoke('enter_text', {
      text: result,
      clipboard: rule.clipboard
    });
  } else if (rule.outputMode === 'popup') {
    // show popup window
    entry.copyOnPopup = rule.clipboard;
    await showPopup(entry, placement);
  }

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
 * @param placement - optional placement for popup window
 */
export async function execute(rule: Rule, selection: string, placement?: WindowPlacement): Promise<string> {
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

  // execute executors in chain until one succeeds
  for (const executor of EXECUTORS) {
    const result = await executor(rule, entry, placement);
    if (result) {
      return typeof result === 'string' ? result : '';
    }
  }
  return '';
}

/**
 * Execute input script and return result.
 *
 * @param script - script object
 * @param entry - record object
 * @returns script execution result
 */
async function executeScript(script: Script, entry: Entry): Promise<Result> {
  try {
    // get script language and code
    const { lang: language, script: code } = script;
    // prepare input data
    const data = {
      datetime: entry.datetime,
      clipboard: entry.clipboard,
      selection: entry.selection
    };

    if (language === 'javascript') {
      // if no custom path, try to execute in frontend first
      if (!nodePath.current && !denoPath.current) {
        try {
          console.debug('Executing JavaScript in WebView');
          // check if code contains async process function
          const asyncPattern = /^\s*async\s+function\s+process\s*\(/m;
          if (asyncPattern.test(code)) {
            return { text: await evalAsync(data, code) };
          } else {
            return { text: evalSync(data, code) };
          }
        } catch (error) {
          console.error(`Failed to execute JavaScript in WebView: ${error}`);
        }
      }

      // execute JavaScript in backend
      const result = await invoke<string>('execute_javascript', {
        code: code,
        data: JSON.stringify(data),
        nodePath: nodePath.current,
        denoPath: denoPath.current
      });
      return { text: result };
    } else if (language === 'python') {
      // execute Python in backend
      const result = await invoke<string>('execute_python', {
        code: code,
        data: JSON.stringify(data),
        pythonPath: pythonPath.current
      });
      return { text: result };
    } else if (language.endsWith('shell')) {
      // execute Shell/PowerShell in backend
      const result = await invoke<string>(`execute_${language}`, {
        code: code,
        data: JSON.stringify(data)
      });
      return { text: result };
    } else {
      throw new Error(`unsupported script language: ${language}`);
    }
  } catch (error) {
    return { text: String(error), error: true };
  }
}

/**
 * Render the input prompt and return the result.
 *
 * @param prompt - prompt object
 * @param entry - record object
 * @returns rendering result
 */
function renderPrompt(prompt: Prompt, entry: Entry): string {
  let result = prompt.prompt || '';

  // use regular expression to replace template parameters
  result = result.replace(/\{\{clipboard\}\}/g, entry.clipboard);
  result = result.replace(/\{\{selection\}\}/g, entry.selection);
  result = result.replace(/\{\{datetime\}\}/g, entry.datetime);

  return result;
}

/**
 * Save entry to history.
 *
 * @param entry - record object to save
 */
function saveHistory(entry: Entry): void {
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
 * @param placement - optional placement for popup window
 */
async function showPopup(entry: Entry, placement?: WindowPlacement): Promise<void> {
  try {
    if (placement) {
      await invoke('show_popup_sameplace', {
        payload: JSON.stringify(entry),
        placement: placement
      });
    } else {
      await invoke('show_popup', {
        payload: JSON.stringify(entry),
        mouse: isMouseShortcut(entry.shortcut)
      });
    }
  } catch (error) {
    console.error(`Failed to show popup window: ${error}`);
  }
}
