import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Execute production functions directly when their surrounding UI/native imports are unnecessary.
function compileFunction(source, name) {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing production function: ${name}`);
  return ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
}

const guardCode = compileFunction(
  readFileSync(new URL('../src/lib/executor.ts', import.meta.url), 'utf8'),
  'createExecutionGuard'
);

// Run the real matcher/evaluator with in-memory settings and native APIs replaced by recording stubs.
function fixture(predicates = [], onInvoke) {
  const calls = [];
  const errors = [];
  const executions = [];
  const listeners = new Map();
  const storage = new Map();
  const timers = [];
  const stores = {
    predicates: { current: predicates, ready: Promise.resolve() },
    regexps: { current: [] },
    models: { current: [] },
    shortcuts: { current: {}, ready: Promise.resolve() },
    toolbarPositionOffsetX: { ready: Promise.resolve() },
    toolbarPositionOffsetY: { ready: Promise.resolve() },
    nodePath: { current: '/configured/node' },
    denoPath: { current: '/configured/deno' }
  };
  const context = createContext({
    console: { debug() {}, warn() {}, error: (...args) => errors.push(args) },
    crypto: { randomUUID },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    setTimeout: (callback) => timers.push(callback)
  });
  context.window = context;
  const createExecutionGuard = runInContext(`${guardCode}\ncreateExecutionGuard`, context);
  const modules = new Map();
  const load = (id) => {
    if (id === '$lib/stores.svelte') return stores;
    if (id === '$lib/paraglide/messages') return { m: new Proxy({}, { get: (_, key) => () => key }) };
    if (id.startsWith('phosphor-svelte/lib/')) return { default() {} };
    if (id === '@tauri-apps/api/core') {
      return {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (onInvoke) return await onInvoke(command, args);
          if (command !== 'send_key') throw new Error(`Unexpected native command: ${command}`);
        }
      };
    }
    if (id === '@tauri-apps/plugin-http') return { fetch: async () => ({ ok: true }) };
    if (id === '@tauri-apps/api/window') return { getCurrentWindow: () => ({ label: 'main' }) };
    if (id === '@tauri-apps/api/event') return { listen: async (event, handler) => listeners.set(event, handler) };
    if (id === './helpers') return { isMouseShortcut: (shortcut) => shortcut === 'MouseClick+MouseMove' };
    if (id === '$lib/executor') {
      return {
        createExecutionGuard,
        execute: async (rule, selection) => executions.push({ rule, selection })
      };
    }
    if (id.startsWith('es-toolkit')) return require(id);
    if (id === './constants') id = '$lib/constants';
    assert.ok(['$lib/constants', '$lib/evaluator', '$lib/matcher', '$lib/shortcut'].includes(id), id);
    if (modules.has(id)) return modules.get(id);
    const source = readFileSync(new URL(`../src/lib/${id.slice('$lib/'.length)}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const exports = {};
    modules.set(id, exports);
    runInContext(`(function(require, exports) { ${outputText}\n})`, context, { filename: id })(load, exports);
    return exports;
  };
  return { load, stores, calls, errors, executions, listeners, modules, context, timers };
}

const predicate = (id, body) => ({ id, script: `function matches(data) { ${body} }` });
const rule = (id, action = id) => ({ id, shortcut: 'test', case: `predicate-${id}`, action });
const input = (selection, appId = '') => ({ selection, appId });

test('passes selection and source appId in data unchanged and accepts async booleans', async () => {
  const { load } = fixture();
  const { evaluatePredicate } = load('$lib/evaluator');
  const text = ' \n中文 "quoted" \\ ` ${value}\t';
  const appId = 'C:\\Program Files\\Example\\app.exe';
  assert.equal(
    await evaluatePredicate(
      input(text, appId),
      `function matches(data) { return data.selection === ${JSON.stringify(text)} && data.appId === ${JSON.stringify(appId)}; }`
    ),
    true
  );
  assert.equal(
    await evaluatePredicate(
      input('no', 'com.apple.Safari'),
      'async function matches(data) { return await Promise.resolve(data.selection === "yes" && data.appId === "com.apple.Safari"); }'
    ),
    false
  );
  assert.equal(
    await evaluatePredicate(
      input(''),
      'const matches = async (data) => data.selection.length === 0 && data.appId === "";'
    ),
    true
  );
});

test('rejects non-boolean values without coercion', async () => {
  const { evaluatePredicate } = fixture().load('$lib/evaluator');
  for (const value of ['"true"', '"false"', '1', '0', '{}', '[]', 'null', 'undefined', 'new Boolean(true)']) {
    await assert.rejects(
      evaluatePredicate(input('text'), `function matches() { return ${value}; }`),
      /must return true or false/
    );
  }
});

test('predicates require matches while action scripts keep process and text output', async () => {
  const { evaluatePredicate, evaluateAction } = fixture().load('$lib/evaluator');
  await assert.rejects(
    evaluatePredicate(input('text'), 'function process() { return true; }'),
    /matches is not defined/
  );
  const data = { selection: ' \ntext\t ', clipboard: 'clip' };
  assert.equal(await evaluateAction(data, 'function process(data) { return data.selection; }'), data.selection);
  assert.equal(await evaluateAction(data, 'function process() { return true; }'), 'true');
  assert.equal(
    await evaluateAction(data, 'async function process(data) { return { value: data.clipboard }; }'),
    '{"value":"clip"}'
  );
  await assert.rejects(evaluateAction(data, 'function matches() { return true; }'), /process is not defined/);
});

test('shares WebView helpers and drains the existing keyboard queue for action scripts', async () => {
  const { load, calls } = fixture();
  const { evaluatePredicate, evaluateAction } = load('$lib/evaluator');
  assert.equal(
    await evaluatePredicate(
      input('  value '),
      'async function matches(data) { return _.trim(data.selection) === "value" && (await _fetch("https://example.test")).ok; }'
    ),
    true
  );
  assert.equal(
    await evaluateAction(
      {},
      'function process() { _keyboard.press("A"); _keyboard.press(["ctrl"], "B"); return "done"; }'
    ),
    'done'
  );
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['send_key', 'send_key']
  );
  assert.equal(calls[0].args.key, 'A');
  assert.equal(calls[1].args.key, 'B');
});

test('quiet matching keeps rule order and always uses WebView despite configured runtimes', async () => {
  const f = fixture([
    predicate('no', 'return false;'),
    predicate('yes', 'return data.selection === "value";'),
    predicate('later', 'throw new Error("must not run");')
  ]);
  const { matchOne } = f.load('$lib/matcher');
  const result = await matchOne('value', [rule('no'), rule('yes'), rule('later')]);
  assert.equal(result.id, 'yes');
  assert.equal(result.caseLabel, 'yes');
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors.length, 0);
});

test('toolbar matching deduplicates actions and continues past script errors', async () => {
  const f = fixture([
    predicate('throw', 'throw new Error("broken");'),
    predicate('wrong', 'return "true";'),
    { id: 'syntax', script: 'function matches( {' },
    { id: 'reject', script: 'async function matches() { throw new Error("rejected"); }' },
    predicate('first', 'return true;'),
    predicate('duplicate', 'throw new Error("deduplicated actions must not run");'),
    predicate('second', 'return true;')
  ]);
  const { matchAll } = f.load('$lib/matcher');
  const result = await matchAll('value', [
    rule('throw'),
    rule('wrong'),
    rule('syntax'),
    rule('reject'),
    rule('first', 'copy'),
    rule('duplicate', 'copy'),
    rule('second', 'paste')
  ]);
  assert.deepEqual(
    Array.from(result, ({ id }) => id),
    ['first', 'second']
  );
  assert.equal(f.errors.length, 4);
  assert.equal(f.calls.length, 0);
});

test('missing, deleted, empty and false predicates do not match', async () => {
  const f = fixture([{ id: 'empty', script: ' \n' }, predicate('no', 'return false;')]);
  const { matchAll, matchOne } = f.load('$lib/matcher');
  assert.equal(await matchOne('value', [rule('missing')]), null);
  assert.equal((await matchAll('value', [rule('empty'), rule('no')])).length, 0);
  f.stores.predicates.current = [predicate('yes', 'return true;')];
  assert.equal((await matchOne('value', [rule('yes')])).id, 'yes');
  f.stores.predicates.current = [];
  assert.equal(await matchOne('value', [rule('yes')]), null);
});

test('waits for saved predicates before matching on startup', async () => {
  const f = fixture();
  let ready;
  f.stores.predicates.ready = new Promise((resolve) => {
    ready = resolve;
  });
  const { matchOne } = f.load('$lib/matcher');
  let settled = false;
  const matching = matchOne('value', [rule('saved')]);
  matching.finally(() => (settled = true));
  await setImmediate();
  assert.equal(settled, false, 'Matching must wait until saved settings have loaded');
  f.stores.predicates.current = [predicate('saved', 'return true;')];
  ready();
  assert.equal((await matching).id, 'saved');
});

test('a settings read failure skips predicate evaluation and allows later rules to match', async () => {
  const f = fixture([predicate('saved', 'return true;')]);
  f.stores.predicates.ready = Promise.reject(new Error('Store unavailable'));
  const { matchOne } = f.load('$lib/matcher');
  const result = await matchOne('value', [rule('saved'), { ...rule('fallback'), case: '' }]);
  assert.equal(result.id, 'fallback');
  assert.equal(f.errors.length, 1);
  assert.equal(f.modules.has('$lib/evaluator'), false);
});

test('existing regex and skip rules keep working without loading the evaluator', async () => {
  const f = fixture();
  f.stores.regexps.current = [{ id: 'custom', pattern: '^abc$', flags: 'i' }];
  const { matchOne } = f.load('$lib/matcher');
  assert.equal((await matchOne('123', [{ ...rule('numbers'), case: 'numbers' }])).case, 'numbers');
  assert.equal((await matchOne('ABC', [{ ...rule('custom'), case: 'regexp-custom' }])).caseLabel, 'custom');
  assert.equal((await matchOne('', [{ ...rule('skip'), case: '' }])).id, 'skip');
  assert.equal(f.modules.has('$lib/evaluator'), false);
});

test('renaming predicates updates cases without changing action scripts with the same name', async () => {
  const f = fixture([predicate('old', 'return true;')]);
  f.stores.shortcuts.current = {
    test: { rules: [rule('old', 'script-old'), { ...rule('other'), case: 'regexp-old' }] }
  };
  const { updateCaseId } = f.load('$lib/shortcut');
  updateCaseId('predicate-', 'old', 'new');
  const [renamed, other] = f.stores.shortcuts.current.test.rules;
  assert.equal(renamed.case, 'predicate-new');
  assert.equal(renamed.action, 'script-old');
  assert.equal(other.case, 'regexp-old');
  f.stores.predicates.current[0].id = 'new';
  assert.equal((await f.load('$lib/matcher').matchOne('value', [renamed])).caseLabel, 'new');
});

test('matching distinguishes applications for identical text in both execution modes', async () => {
  const f = fixture([
    predicate('safari', 'return data.selection === "value" && data.appId === "com.apple.Safari";'),
    predicate('windows', 'return data.appId === "C:\\\\Apps\\\\Editor.exe";'),
    predicate('unknown', 'return data.appId === "";')
  ]);
  const { matchOne, matchAll } = f.load('$lib/matcher');
  const rules = [rule('safari'), rule('windows'), rule('unknown')];
  assert.equal((await matchOne('value', rules, 'com.apple.Safari')).id, 'safari');
  assert.equal((await matchOne('value', rules, 'C:\\Apps\\Editor.exe')).id, 'windows');
  assert.equal(await matchOne('value', rules, 'com.apple.TextEdit'), null);
  assert.deepEqual(
    Array.from(await matchAll('value', rules, 'com.apple.Safari'), ({ id }) => id),
    ['safari']
  );
  assert.equal((await matchOne('value', rules)).id, 'unknown');
});

test('mouse toolbar predicates receive the event appId after fetching missing selection', async () => {
  const f = fixture(
    [predicate('source', 'return data.selection === " selected " && data.appId === "com.apple.Safari";')],
    async (command) => {
      if (command === 'get_selection') return ' selected ';
      if (command !== 'show_toolbar') throw new Error(`Unexpected native command: ${command}`);
    }
  );
  const shortcut = 'MouseClick+MouseMove';
  f.stores.shortcuts.current[shortcut] = { mode: 'toolbar', rules: [rule('source')] };
  f.load('$lib/shortcut');
  await f.listeners.get('shortcut')({ payload: { shortcut, selection: '', appId: 'com.apple.Safari' } });
  assert.deepEqual(
    f.calls.map(({ command }) => command),
    ['get_selection', 'show_toolbar']
  );
  const payload = JSON.parse(f.calls[1].args.payload);
  assert.equal(payload.selection, ' selected ');
  assert.equal(payload.rules[0].caseLabel, 'source');
  assert.equal(f.errors.length, 0);
});

test('keyboard quiet predicates use the supplied appId and keep empty IDs usable', async () => {
  const f = fixture([
    predicate('source', 'return data.selection === "selected" && data.appId === "com.apple.TextEdit";'),
    predicate('unknown', 'return data.appId === "";')
  ]);
  const shortcut = 'Control+Shift+KeyT';
  f.stores.shortcuts.current[shortcut] = { mode: 'quiet', rules: [rule('source'), rule('unknown')] };
  f.load('$lib/shortcut');
  const handle = f.listeners.get('shortcut');
  await handle({ payload: { shortcut, selection: 'selected', appId: 'com.apple.TextEdit' } });
  await handle({ payload: { shortcut, selection: 'selected', appId: '' } });
  await handle({ payload: { shortcut, selection: 'selected' } });
  assert.deepEqual(
    f.executions.map(({ rule }) => rule.id),
    ['source', 'unknown', 'unknown']
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors.length, 0);
});

test('concurrent asynchronous predicates keep each selection paired with its application', async () => {
  const f = fixture([
    {
      id: 'pair',
      script: 'async function matches(data) { await window.wait; return data.selection === data.appId; }'
    }
  ]);
  let release;
  f.context.wait = new Promise((resolve) => {
    release = resolve;
  });
  const { matchOne } = f.load('$lib/matcher');
  const yes = matchOne('com.apple.Safari', [rule('pair')], 'com.apple.Safari');
  const no = matchOne('com.apple.Safari', [rule('pair')], 'com.apple.TextEdit');
  await setImmediate();
  release();
  assert.equal((await yes).id, 'pair');
  assert.equal(await no, null);
});

test('superseded predicates cannot execute actions or reopen the toolbar', async () => {
  for (const mode of ['quiet', 'toolbar']) {
    for (const newestMatches of [true, false]) {
      const f = fixture(
        [
          {
            id: 'slow',
            script: `async function matches(data) {
            if (data.selection === 'old') {
              window.started();
              await window.wait;
            }
            return data.selection === data.appId;
          }`
          }
        ],
        async (command) => assert.equal(command, 'show_toolbar')
      );
      let release;
      f.context.wait = new Promise((resolve) => (release = resolve));
      const started = new Promise((resolve) => (f.context.started = resolve));
      const shortcut = 'MouseClick+MouseMove';
      f.stores.shortcuts.current[shortcut] = { mode, rules: [rule('slow')] };
      f.load('$lib/shortcut');
      const handle = f.listeners.get('shortcut');
      const old = handle({ payload: { shortcut, selection: 'old', appId: 'old' } });
      await started;
      await handle({ payload: { shortcut, selection: 'new', appId: newestMatches ? 'new' : 'other' } });
      release();
      await old;
      const results = mode === 'quiet' ? f.executions : f.calls.map(({ args }) => JSON.parse(args.payload));
      assert.deepEqual(
        results.map(({ selection }) => selection),
        newestMatches ? ['new'] : [],
        mode
      );
      assert.equal(f.errors.length, 0);
    }
  }
});

test('a newer keyboard selection invalidates an already scheduled toolbar display', async () => {
  const f = fixture([predicate('yes', 'return true;')], async (command) => assert.equal(command, 'show_toolbar'));
  const shortcut = 'Control+Shift+KeyT';
  f.stores.shortcuts.current[shortcut] = { mode: 'toolbar', rules: [rule('yes')] };
  f.load('$lib/shortcut');
  const handle = f.listeners.get('shortcut');
  await handle({ payload: { shortcut, selection: 'old', appId: 'com.apple.Safari' } });
  await handle({ payload: { shortcut, selection: 'new', appId: 'com.apple.TextEdit' } });
  assert.equal(f.timers.length, 2);
  for (const callback of f.timers) await callback();
  assert.deepEqual(
    f.calls.map(({ args }) => JSON.parse(args.payload).selection),
    ['new']
  );
  assert.equal(f.errors.length, 0);
});
