/**
 * Large Language Model providers.
 */
export const LLM_PROVIDERS = ['ollama', 'lmstudio', 'openrouter', 'openai', 'anthropic', 'google', 'xai'] as const;

/**
 * Mouse drag shortcut.
 */
export const DRAG_SHORTCUT = 'MouseClick+MouseMove';

/**
 * Mouse double-click shortcut.
 */
export const DBCLICK_SHORTCUT = 'MouseClick+MouseClick';

/**
 * Shift + Mouse click shortcut.
 */
export const SHIFT_CLICK_SHORTCUT = 'Shift+MouseClick';

/**
 * Long press shortcut.
 */
export const LONG_PRESS_SHORTCUT = 'LongPress';

/**
 * Classification model prefix.
 */
export const MODEL_MARK = 'model-';

/**
 * Regular expression prefix.
 */
export const REGEXP_MARK = 'regexp-';

/**
 * Script prefix.
 */
export const SCRIPT_MARK = 'script-';

/**
 * Prompt prefix.
 */
export const PROMPT_MARK = 'prompt-';

/**
 * Searcher prefix.
 */
export const SEARCHER_MARK = 'searcher-';

/**
 * Toolbar visible action count.
 */
export const TOOLBAR_ACTION_COUNT = {
  min: 1,
  default: 6,
  max: 12
};

/**
 * Popup window default size.
 */
export const DEFAULT_POPUP_WINDOW_SIZE = {
  width: 400,
  height: 300
};

/**
 * Popup window minimum size.
 */
export const MIN_POPUP_WINDOW_SIZE = {
  width: 320,
  height: 220
};
