<script lang="ts" module>
  import { guessProgrammingLanguage } from '$lib/matcher';
  import { m } from '$lib/paraglide/messages';
  import type { Language, LanguageSupport } from '@codemirror/language';
  import type { Extension } from '@codemirror/state';
  import type { Options } from 'prettier';
  import babel from 'prettier/plugins/babel';
  import estree from 'prettier/plugins/estree';
  import html from 'prettier/plugins/html';
  import markdown from 'prettier/plugins/markdown';
  import postcss from 'prettier/plugins/postcss';
  import yaml from 'prettier/plugins/yaml';
  import * as prettier from 'prettier/standalone';

  export type CodeMirrorProps = Partial<{
    /** Document language. */
    language: LanguageSupport | Language | null;
    /** Document content. */
    document: string;
    /** Placeholder text. */
    placeholder: string;
    /** Tab size in spaces. */
    tabSize: number;
    /** Maximum line length. */
    lineLength: number;
    /** Whether the editor is read-only. */
    readOnly: boolean;
    /** Whether to use dark theme. */
    darkMode: boolean | 'auto';

    /** Container class name. */
    class: string;
    /** Panel class name. */
    panelClass: string;
    /** Editor class name. */
    editorClass: string;
    /** Minimum height of editor. */
    minHeight: string | null;
    /** Maximum height of editor. */
    maxHeight: string | null;
    /** Minimum width of editor. */
    minWidth: string | null;
    /** Maximum width of editor. */
    maxWidth: string | null;

    /** Title of enlarged view. */
    title: string;
    /** Whether to enable enlarged view feature. */
    enlarger: boolean;
    /** Whether to show copy button in panel. */
    copier: boolean;
    /** Whether to show reset button in panel. */
    resetter: boolean;
    /** Whether to show format button in panel. */
    formatter: boolean;
    /** Callback function when document changes. */
    onchange: (doc: string) => void;
  }>;

  /**
   * Guess language type from document content.
   *
   * @param doc - document content
   */
  async function guessLanguageType(doc: string): Promise<string | null> {
    const langs: Record<string, string> = {
      js: 'javascript',
      json: 'json',
      css: 'css',
      html: 'css',
      yaml: 'yaml',
      md: 'markdown'
    };
    const lang = await guessProgrammingLanguage(doc, Object.keys(langs));
    return lang ? langs[lang] : null;
  }

  /**
   * Get language name from language support object.
   *
   * @param language - language support object
   */
  function getLanguageName(language: LanguageSupport | Language | null | undefined): string {
    let name = null;
    if (language) {
      name = 'name' in language ? language.name : language.language.name;
    } else {
      // default to plain text
      name = 'text';
    }
    // mapping of language names not capitalized
    const mappings: Record<string, string> = {
      javascript: 'JavaScript',
      json: 'JSON',
      css: 'CSS',
      html: 'HTML',
      yaml: 'YAML',
      powershell: 'PowerShell'
    };
    // return mapped name or capitalized name
    return mappings[name] || name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Replace document in editor view.
   *
   * @param view - editor view
   * @param newDoc - new document
   */
  function replaceDocument(view: EditorView, newDoc: string | undefined) {
    // https://codemirror.net/examples/change/
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newDoc }
    });
  }

  /**
   * Supported formatting options for different languages.
   */
  const formatOptions: Record<string, Options> = {
    javascript: { parser: 'babel', plugins: [babel, estree], singleQuote: true },
    json: { parser: 'json', plugins: [babel, estree] },
    css: { parser: 'css', plugins: [postcss] },
    html: { parser: 'html', plugins: [html] },
    yaml: { parser: 'yaml', plugins: [yaml], singleQuote: true },
    markdown: { parser: 'markdown', plugins: [markdown] }
  };

  /**
   * Format document based on language type.
   *
   * @param view - editor view
   * @param language - document language
   * @param tabSize - tab size in spaces
   * @param lineLength - maximum line length
   */
  async function formatDocument(view: EditorView, language: string, tabSize: number, lineLength: number) {
    const option = formatOptions[language.toLowerCase()];
    if (!option) {
      return;
    }
    try {
      const source = view.state.doc.toString();
      const formatted = await prettier.format(source, {
        ...option,
        tabWidth: tabSize,
        printWidth: lineLength
      });
      replaceDocument(view, formatted);
    } catch (error) {
      console.error(`Failed to format document: ${error}`);
    }
  }

  /**
   * Translation of phrases in editor.
   */
  const phrases: Record<string, string> = {
    // search related translations
    Find: m.cm_find(),
    Replace: m.cm_replace(),
    next: m.cm_next(),
    previous: m.cm_previous(),
    all: m.cm_all(),
    'match case': m.cm_match_case(),
    regexp: m.cm_regexp(),
    'by word': m.cm_by_word(),
    replace: m.cm_replace_action(),
    'replace all': m.cm_replace_all(),
    close: m.cm_close(),
    'current match': m.cm_current_match(),
    'on line': m.cm_on_line(),
    'replaced match on line $': m.cm_replaced_match_on_line(),
    'replaced $ matches': m.cm_replaced_matches(),
    // jump related translations
    'Go to line': m.cm_go_to_line(),
    go: m.cm_go()
  };
</script>

<script lang="ts">
  import { Button, Modal } from '$lib/components';
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
    syntaxHighlighting
  } from '@codemirror/language';
  import { lintKeymap } from '@codemirror/lint';
  import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
  import { Compartment, EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder,
    rectangularSelection
  } from '@codemirror/view';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    ArrowCounterClockwiseIcon,
    CodeIcon,
    CopySimpleIcon,
    FrameCornersIcon,
    TextIndentIcon
  } from 'phosphor-svelte';
  import { onMount } from 'svelte';
  import CodeMirror from './CodeMirror.svelte';

  let {
    language,
    document = $bindable(),
    placeholder: _placeholder,
    tabSize = 4,
    lineLength = 80,
    readOnly = false,
    darkMode = 'auto',

    class: _class,
    panelClass,
    editorClass,
    minHeight = '8rem',
    maxHeight = '20rem',
    minWidth = '100%',
    maxWidth = '100%',

    title = '',
    enlarger: _enlarger,
    copier = true,
    resetter = true,
    formatter = true,
    onchange
  }: CodeMirrorProps = $props();
  let enlarger = $derived(_enlarger ?? !readOnly);

  let editor: HTMLDivElement;
  let editorView: EditorView;
  let largerView: Modal | null = $state(null);
  let originalDoc = document;
  const languageName = $derived(getLanguageName(language));

  /**
   * Reset document content.
   */
  export function reset() {
    replaceDocument(editorView, originalDoc);
  }

  /**
   * Format document content.
   */
  export function format() {
    if (language) {
      // use language type from language support object
      formatDocument(editorView, languageName, tabSize, lineLength);
    } else if (document) {
      // try to guess language type from document content
      guessLanguageType(document).then((lang) => {
        if (lang) {
          formatDocument(editorView, lang, tabSize, lineLength);
        }
      });
    }
  }

  /**
   * Copy document content to clipboard.
   */
  export function copy() {
    document && navigator.clipboard && navigator.clipboard.writeText(document);
  }

  /**
   * Basic extension set for editor.
   *
   * https://github.com/codemirror/basic-setup
   */
  const basicSetup: Extension = [
    lineNumbers(),
    indentOnInput(),
    history(),
    autocompletion(),
    closeBrackets(),
    bracketMatching(),
    dropCursor(),
    crosshairCursor(),
    drawSelection(),
    rectangularSelection(),
    EditorState.phrases.of(phrases),
    EditorState.allowMultipleSelections.of(true),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    highlightSpecialChars(),
    // foldGutter(),
    // highlightActiveLine(),
    // highlightActiveLineGutter(),
    // highlightSelectionMatches(),
    keymap.of([
      ...defaultKeymap,
      ...foldKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...lintKeymap
    ])
  ];

  /**
   * Extension for styling editor.
   *
   * https://codemirror.net/examples/styling/
   */
  const styleSheets: Extension = $derived([
    EditorView.baseTheme({
      '&': {
        userSelect: 'text'
      },
      '.cm-content, .cm-gutter': {
        cursor: 'text'
      },
      '.cm-scroller': {
        overflow: 'auto',
        overscrollBehavior: 'none'
      },
      '&.cm-focused': {
        outline: 'none'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--color-base-200)',
        border: 'none'
      }
    }),
    EditorView.theme({
      '&': {
        minWidth: minWidth,
        maxWidth: maxWidth,
        maxHeight: maxHeight
      },
      '.cm-content, .cm-gutter': {
        minHeight: minHeight
      }
    })
  ]);

  /**
   * Extension for specified language support.
   */
  const languageSupport: Extension = $derived(language ? language : []);

  /**
   * Extension for listening to document changes.
   */
  const updateListener: Extension = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      document = update.state.doc.toString();
      onchange?.(document);
    }
  });

  /**
   * Extension for handling tab key.
   *
   * https://codemirror.net/examples/tab/
   */
  const tabKeyHandler: Extension = $derived([keymap.of([indentWithTab]), indentUnit.of(' '.repeat(tabSize))]);

  /**
   * Extension for making editor read-only.
   */
  const readOnlyHandler: Extension = (() => {
    if (readOnly) {
      return [EditorState.readOnly.of(true), EditorView.editable.of(false)];
    }
    // only highlight active line when editor is editable
    return [foldGutter(), highlightActiveLine(), highlightActiveLineGutter(), highlightSelectionMatches()];
  })();

  /**
   * Extension for enabling placeholder text.
   */
  const placeholderHandler: Extension = $derived(_placeholder ? placeholder(_placeholder) : []);

  /**
   * Extension for editor theme.
   */
  const editorTheme = new Compartment();
  const getEditorTheme = () => {
    if (darkMode === true) {
      return oneDark;
    } else if (darkMode === 'auto') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        return oneDark;
      }
    }
    return [];
  };
  const themeHandler: Extension = editorTheme.of(getEditorTheme());

  // listen to theme change events
  onMount(() => {
    const unlisten = getCurrentWindow().onThemeChanged(() => {
      if (editorView) {
        editorView.dispatch({ effects: editorTheme.reconfigure(getEditorTheme()) });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  // create editor view
  onMount(() => {
    editorView = new EditorView({
      parent: editor,
      // create editor state
      state: EditorState.create({
        doc: document,
        extensions: [
          basicSetup,
          styleSheets,
          languageSupport,
          updateListener,
          tabKeyHandler,
          readOnlyHandler,
          placeholderHandler,
          themeHandler
        ]
      })
    });
    return () => {
      // destroy editor view
      editorView.destroy();
    };
  });
</script>

<div class="shrink-0 overflow-auto rounded-box border {_class}">
  <div class={editorClass} bind:this={editor}></div>
  <div class="flex items-center justify-between border-t px-2 py-1 {panelClass}">
    <span class="flex items-center gap-2">
      {#if enlarger}
        <Button
          icon={FrameCornersIcon}
          class="border-0 bg-transparent shadow-none {enlarger ? '' : 'pointer-events-none'}"
          onclick={() => enlarger && largerView?.show()}
        />
      {/if}
      <span class="text-xs font-semibold opacity-70">{languageName}</span>
    </span>
    <span class="flex items-center gap-2">
      {#if !readOnly && resetter}
        <Button icon={ArrowCounterClockwiseIcon} class="border-0 bg-transparent shadow-none" onclick={reset} />
      {/if}
      {#if !readOnly && formatter && languageName.toLowerCase() in formatOptions}
        <Button icon={TextIndentIcon} class="border-0 bg-transparent shadow-none" onclick={format} />
      {/if}
      {#if copier}
        <Button icon={CopySimpleIcon} class="border-0 bg-transparent shadow-none" onclick={copy} />
      {/if}
    </span>
  </div>
</div>

{#if enlarger}
  <Modal icon={CodeIcon} title={title || languageName} maxWidth="80rem" bind:this={largerView}>
    <CodeMirror
      {language}
      bind:document
      placeholder={_placeholder}
      {tabSize}
      {lineLength}
      {readOnly}
      {darkMode}
      minHeight="60dvh"
      maxHeight="calc(90dvh - 10rem)"
      minWidth="100%"
      maxWidth="100%"
      enlarger={false}
      {copier}
      {resetter}
      {formatter}
      onchange={() => replaceDocument(editorView, document)}
    />
  </Modal>
{/if}
