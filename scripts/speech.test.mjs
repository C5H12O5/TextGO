import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

function loadSpeechModule(globals = {}) {
  const source = readFileSync(new URL('../src/lib/speech.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;

  const exports = {};
  const module = { exports };
  const context = createContext({
    exports,
    module,
    setTimeout,
    clearTimeout,
    ...globals
  });
  runInContext(transpiled, context);
  return module.exports;
}

test('resolveSpeechLocale maps all supported natural languages and normalizes locales', () => {
  const { resolveSpeechLocale } = loadSpeechModule();
  assert.equal(resolveSpeechLocale('en'), 'en-US');
  assert.equal(resolveSpeechLocale('zh'), 'zh-CN');
  assert.equal(resolveSpeechLocale('ja'), 'ja-JP');
  assert.equal(resolveSpeechLocale('ko'), 'ko-KR');
  assert.equal(resolveSpeechLocale('ru'), 'ru-RU');
  assert.equal(resolveSpeechLocale('fr'), 'fr-FR');
  assert.equal(resolveSpeechLocale('de'), 'de-DE');
  assert.equal(resolveSpeechLocale('es'), 'es-ES');
  assert.equal(resolveSpeechLocale('pt'), 'pt-BR');
  assert.equal(resolveSpeechLocale('ar'), 'ar-SA');
  assert.equal(resolveSpeechLocale('zh_TW'), 'zh-TW');
  assert.equal(resolveSpeechLocale(''), '');
});

test('markdownToSpeechText strips markdown syntax including nested emphasis and tables', () => {
  const { markdownToSpeechText } = loadSpeechModule();
  const input = [
    '# Title',
    '',
    'This is ***very bold***, **bold**, _italic_, ~~old~~, and `inline`.',
    '> Quote with [a link](https://example.com) and ![diagram](img.png).',
    '- Bullet item',
    '| Key | Value |',
    '| --- | --- |',
    '| One | Two |',
    '```js',
    'const x = 1;',
    '```'
  ].join('\n');

  assert.equal(
    markdownToSpeechText(input),
    'Title\n\nThis is very bold, bold, italic, old, and inline.\nQuote with a link and diagram.\nBullet item\nKey, Value\n\nOne, Two\nconst x = 1;'
  );
});

test('splitSpeechChunks splits multilingual paragraphs and overlong sentences cleanly', () => {
  const { splitSpeechChunks } = loadSpeechModule();

  assert.deepEqual(Array.from(splitSpeechChunks('Hello world. How are you?\n\nSecond paragraph.')), [
    'Hello world. How are you?',
    'Second paragraph.'
  ]);

  const longCjk =
    '第一句内容比较长，用来测试中文分句是否正常。第二句也很长，确保超过阈值时会切分成多段。第三句作为收尾！';
  const cjkChunks = splitSpeechChunks(longCjk, 25);
  assert.equal(cjkChunks.length, 3);
  assert.equal(cjkChunks[0], '第一句内容比较长，用来测试中文分句是否正常。');
  assert.equal(cjkChunks[1], '第二句也很长，确保超过阈值时会切分成多段。');
  assert.equal(cjkChunks[2], '第三句作为收尾！');

  const overlongClause = 'alpha beta gamma, delta epsilon zeta, eta theta iota, kappa lambda mu';
  const clauseChunks = splitSpeechChunks(overlongClause, 25);
  assert.ok(clauseChunks.length >= 3);
  assert.ok(clauseChunks.every((chunk) => chunk.length <= 25));
});

test('selectBestVoice prioritizes natural/premium voices, avoids novelty voices, and respects offline mode', () => {
  const { selectBestVoice } = loadSpeechModule();

  const macVoices = [
    { name: 'Albert', lang: 'en-US', default: true, localService: true, voiceURI: 'com.apple.speech.albert' },
    {
      name: 'Samantha',
      lang: 'en-US',
      default: true,
      localService: true,
      voiceURI: 'com.apple.voice.compact.en-US.Samantha'
    },
    {
      name: 'Samantha (Enhanced)',
      lang: 'en-US',
      default: false,
      localService: true,
      voiceURI: 'com.apple.voice.enhanced.en-US.Samantha'
    },
    {
      name: 'Daniel',
      lang: 'en-GB',
      default: true,
      localService: true,
      voiceURI: 'com.apple.voice.compact.en-GB.Daniel'
    },
    {
      name: 'Majed',
      lang: 'ar-001',
      default: true,
      localService: true,
      voiceURI: 'com.apple.voice.compact.ar-001.Majed'
    },
    {
      name: 'Meijia',
      lang: 'zh-TW',
      default: true,
      localService: true,
      voiceURI: 'com.apple.voice.compact.zh-TW.Meijia'
    },
    {
      name: 'Tingting',
      lang: 'zh-CN',
      default: true,
      localService: true,
      voiceURI: 'com.apple.voice.compact.zh-CN.Tingting'
    }
  ];

  assert.equal(selectBestVoice(macVoices, 'en')?.name, 'Samantha (Enhanced)');
  assert.equal(selectBestVoice(macVoices, 'ar')?.name, 'Majed');
  assert.equal(selectBestVoice(macVoices, 'zh')?.name, 'Tingting');
  assert.equal(selectBestVoice(macVoices, 'ja'), null);

  const winVoices = [
    {
      name: 'Microsoft David - English (United States)',
      lang: 'en-US',
      default: true,
      localService: true,
      voiceURI: 'david'
    },
    {
      name: 'Microsoft Aria Online (Natural) - English (United States)',
      lang: 'en-US',
      default: false,
      localService: false,
      voiceURI: 'aria'
    }
  ];
  assert.equal(
    selectBestVoice(winVoices, 'en', false)?.name,
    'Microsoft Aria Online (Natural) - English (United States)'
  );
  assert.equal(selectBestVoice(winVoices, 'en', true)?.name, 'Microsoft David - English (United States)');
});

test('createSpeechController stays lazy, chains chunks, ignores empty voiceschanged, and handles fallback/interruption', async () => {
  let voices = [];
  let getVoicesCalls = 0;
  let cancelCount = 0;
  let resumeCount = 0;
  const listeners = new Set();
  const spoken = [];

  class MockUtterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
    }
  }

  const synth = {
    paused: true,
    getVoices: () => {
      getVoicesCalls += 1;
      return voices;
    },
    addEventListener: (type, fn) => {
      if (type === 'voiceschanged') listeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === 'voiceschanged') listeners.delete(fn);
    },
    resume: () => {
      resumeCount += 1;
      synth.paused = false;
    },
    speak: (utterance) => {
      spoken.push(utterance);
      if (utterance.voice?.localService === false) {
        utterance.onerror?.({ error: 'network' });
        return;
      }
      utterance.onstart?.();
    },
    cancel: () => {
      cancelCount += 1;
    }
  };

  const { createSpeechController } = loadSpeechModule({
    window: { speechSynthesis: synth },
    navigator: { onLine: true },
    SpeechSynthesisUtterance: MockUtterance
  });

  const controller = createSpeechController();

  // Lazy until warmUp/speak: creating or calling idle stop does not touch speechSynthesis.
  assert.equal(getVoicesCalls, 0);
  assert.equal(listeners.size, 0);
  controller.stop();
  assert.equal(cancelCount, 0);

  controller.warmUp();
  assert.equal(listeners.size, 1);

  // Populate voices (online + local), then emit a spurious empty voiceschanged (as macOS WKWebView does).
  voices = [
    { name: 'Microsoft Aria Online (Natural)', lang: 'en-US', default: false, localService: false, voiceURI: 'aria' },
    { name: 'Microsoft David', lang: 'en-US', default: true, localService: true, voiceURI: 'david' }
  ];
  for (const fn of listeners) fn();
  voices = [];
  for (const fn of listeners) fn();

  // Online voice fails with network error before start -> automatically falls back to local voice.
  let started = 0;
  let ended = 0;
  let errors = 0;
  const ok = await controller.speak('First paragraph.\n\nSecond paragraph.', 'en', {
    onStart: () => (started += 1),
    onEnd: () => (ended += 1),
    onError: () => (errors += 1)
  });

  assert.equal(ok, true);
  assert.equal(resumeCount, 1);
  assert.equal(errors, 0);
  assert.equal(started, 1);
  assert.equal(spoken.length, 2);
  assert.equal(spoken[0].voice?.name, 'Microsoft Aria Online (Natural)');
  assert.equal(spoken[1].voice?.name, 'Microsoft David');
  assert.equal(spoken[1].text, 'First paragraph.');

  // Finish chunk 1 -> triggers chunk 2 with fallback local voice.
  spoken[1].onend();
  assert.equal(spoken.length, 3);
  assert.equal(spoken[2].text, 'Second paragraph.');
  assert.equal(ended, 0);

  // External OS interruption ends cleanly without raising an error toast.
  spoken[2].onerror({ error: 'interrupted' });
  assert.equal(ended, 1);
  assert.equal(errors, 0);

  // Requesting an unavailable language when voices are cached reports no-voice cleanly.
  let errorReason = '';
  const missingOk = await controller.speak('こんにちは', 'ja', {
    onError: (reason) => (errorReason = reason)
  });
  assert.equal(missingOk, false);
  assert.equal(errorReason, 'no-voice');

  controller.destroy();
  assert.equal(listeners.size, 0);
});
