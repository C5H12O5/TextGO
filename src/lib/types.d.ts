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
 * Type of option.
 */
export type Option = {
  /** Option value. */
  value: OptionValue;
  /** Option label. */
  label: string;
  /** Whether disabled. */
  disabled?: boolean;
  /** Regular expression. */
  pattern?: RegExp;
  /** Option icon. */
  icon?: Component<IconComponentProps>;
};

/**
 * Type of triggered record.
 */
export type Entry = {
  /** Record ID. */
  id: string;
  /** Triggered shortcut. */
  shortcut: string;
  /** Trigger time. */
  datetime: string;
  /** Clipboard text. */
  clipboard: string;
  /** Selected text. */
  selection: string;
  /** Text type. */
  caseLabel?: string;
  /** Triggered action. */
  actionLabel?: string;
  /** Action type. */
  actionType?: 'script' | 'prompt';
  /** Execution result (script return value / prompt content). */
  result?: string;
  /** Script language. */
  scriptLang?: 'javascript' | 'python';
  /** Model provider. */
  provider?: 'ollama' | 'lmstudio';
  /** Model name. */
  model?: string;
  /** System prompt. */
  systemPrompt?: string;
  /** Response content. */
  response?: string;
};

/**
 * Type of rule.
 */
export type Rule = {
  /** Rule ID. */
  id: string;
  /** Bound shortcut string. */
  shortcut: string;
  /** Bound text type. */
  case: string;
  /** Case label. */
  caseLabel?: string;
  /** ID of the action to execute. */
  action: string;
  /** Action label. */
  actionLabel?: string;
};

/**
 * Type of script.
 */
export type Script = {
  /** Script ID. */
  id: string;
  /** Script language. */
  lang: 'javascript' | 'python';
  /** Script content. */
  script: string;
};

/**
 * Type of prompt.
 */
export type Prompt = {
  /** Prompt ID. */
  id: string;
  /** Model provider. */
  provider: 'ollama' | 'lmstudio';
  /** Model name. */
  model: string;
  /** Prompt content. */
  prompt: string;
  /** System prompt. */
  systemPrompt?: string;
};

/**
 * Type of classification model.
 */
export type Model = {
  /** Model ID. */
  id: string;
  /** Training sample. */
  sample: string;
  /** Confidence threshold. */
  threshold: number;
  /** Whether model is trained. */
  modelTrained?: boolean;
};

/**
 * Type of regular expression.
 */
export type Regexp = {
  /** Regex ID. */
  id: string;
  /** Regex pattern. */
  pattern: string;
  /** Regex flags. */
  flags?: string;
};
