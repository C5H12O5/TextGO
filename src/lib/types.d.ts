import type { IconComponentProps } from 'phosphor-svelte';
import type { Component } from 'svelte';

/**
 * Convert all properties in type T to nullable.
 */
export type Optional<T> = {
  [P in keyof T]?: T[P] | null;
};

/**
 * Convert type T itself to nullable.
 */
type Nullable<T> = T | null | undefined;

/**
 * Type of option value.
 */
export type OptionValue = string | number | boolean | null | undefined;

/**
 * Type of selectable option.
 */
export type Option = {
  /** Option value. */
  value: OptionValue;
  /** Option label. */
  label: string;
  /** Option icon. */
  icon?: Component<IconComponentProps> | string;
  /** Regular expression. */
  pattern?: RegExp;
  /** Whether disabled. */
  disabled?: boolean;
};

/**
 * Type of action option.
 */
type ActOption = Option & {
  /** Whether built-in action. */
  builtIn?: boolean;
  /** Whether no result action. */
  noResult?: boolean;
  /** Whether AI conversation action. */
  promptMode?: boolean;
};

/**
 * Type of text processor.
 */
type Processor = ActOption & {
  /** Text processing function. */
  process: (selection: string) => string;
};

/**
 * Execution mode for shortcut.
 */
export type ExecutionMode = 'quiet' | 'toolbar';

/**
 * Output mode for execution result.
 */
export type OutputMode = 'replace' | 'popup';

/**
 * Display mode for action in toolbar.
 */
export type DisplayMode = 'icon' | 'label' | 'both';

/**
 * Action type.
 */
export type ActionType = 'script' | 'prompt' | 'searcher';

/**
 * Script language.
 */
export type ScriptLang = 'javascript' | 'python';

/**
 * AI model provider.
 */
export type ModelProvider = 'ollama' | 'lmstudio' | 'openrouter' | 'openai' | 'anthropic' | 'google';

/**
 * Type of shortcut-triggered record.
 */
export type Entry = {
  /** Record ID. */
  id: string;
  /** Shortcut string. */
  shortcut: string;
  /** Trigger time. */
  datetime: string;
  /** Clipboard text. */
  clipboard: string;
  /** Selected text. */
  selection: string;
  /** Text type label. */
  caseLabel?: string;
  /** Action type. */
  actionType?: ActionType;
  /** Action label. */
  actionLabel?: string;
  /** Execution result (script return value / prompt content). */
  result?: string;
  /** Script language. */
  scriptLang?: ScriptLang;
  /** Model provider. */
  provider?: ModelProvider;
  /** Model name. */
  model?: string;
  /** System prompt. */
  systemPrompt?: string;
  /** Response content. */
  response?: string;
};

/**
 * Type of rule within a shortcut.
 */
export type Rule = {
  /** Rule ID. */
  id: string;
  /** Bound shortcut string. */
  shortcut: string;
  /** Bound text type. */
  case: string;
  /** Text type label. */
  caseLabel?: string;
  /** Bound action ID. */
  action: string;
  /** Action label. */
  actionLabel?: string;
  /** How to display the action in toolbar. */
  displayMode?: DisplayMode;
  /** How to output execution result. */
  outputMode?: OutputMode;
  /** Whether to preview execution result in toolbar. */
  preview?: boolean;
  /** Whether to save execution result to history. */
  history?: boolean;
  /** Whether to copy execution result to clipboard. */
  clipboard?: boolean;
};

/**
 * Mouse or keyboard shortcut type.
 */
export type Shortcut = {
  /** Execution mode. */
  mode: ExecutionMode;
  /** List of rules. */
  rules: Rule[];
  /** Whether the shortcut is disabled. */
  disabled?: boolean;
  /** Whether the rules are collapsed in the UI. */
  collapsed?: boolean;
  /** Blacklisted application bundle IDs. */
  blacklist?: string[];
};

/**
 * Classification model type.
 */
export type Model = {
  /** Model ID. */
  id: string;
  /** Model icon. */
  icon?: string;
  /** Training sample. */
  sample: string;
  /** Confidence threshold. */
  threshold: number;
  /** Whether model is trained. */
  modelTrained?: boolean;
};

/**
 * Regular expression type.
 */
export type Regexp = {
  /** Regex ID. */
  id: string;
  /** Regex icon. */
  icon?: string;
  /** Regex pattern. */
  pattern: string;
  /** Regex flags. */
  flags?: string;
};

/**
 * Script action.
 */
export type Script = {
  /** Action ID. */
  id: string;
  /** Action icon. */
  icon?: string;
  /** Script language. */
  lang: ScriptLang;
  /** Script content. */
  script: string;
};

/**
 * AI conversation action.
 */
export type Prompt = {
  /** Action ID. */
  id: string;
  /** Action icon. */
  icon?: string;
  /** Model provider. */
  provider: ModelProvider;
  /** Model name. */
  model: string;
  /** Prompt content. */
  prompt: string;
  /** System prompt. */
  systemPrompt?: string;
};

/**
 * Web search action.
 */
export type Searcher = {
  /** Action ID. */
  id: string;
  /** Action icon. */
  icon?: string;
  /** Browser to use. */
  browser?: string;
  /** Search URL. */
  url: string;
};
