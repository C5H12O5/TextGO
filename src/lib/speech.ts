/**
 * Preferred BCP-47 speech locales for the supported natural languages.
 */
const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ru: 'ru-RU',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  pt: 'pt-BR',
  ar: 'ar-SA'
};

/**
 * macOS novelty and eloquence voice names that should be deprioritized for normal reading.
 */
const NOVELTY_VOICE_NAMES = new Set([
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'eddy',
  'flo',
  'fred',
  'good news',
  'grandma',
  'grandpa',
  'jester',
  'junior',
  'kathy',
  'organ',
  'ralph',
  'reed',
  'rocko',
  'sandy',
  'shelley',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox'
]);

const DEFAULT_CHUNK_MAX_LENGTH = 220;
const VOICES_WAIT_TIMEOUT_MS = 350;

/**
 * Normalize a BCP-47 language tag to lowercase hyphenated form.
 *
 * @param lang - raw language code or locale
 * @returns normalized language tag
 */
function normalizeLangTag(lang?: string): string {
  return (lang ?? '').trim().replace(/_/g, '-').toLowerCase();
}

/**
 * Extract the primary language subtag from a language code or locale.
 *
 * @param lang - raw language code or locale
 * @returns lowercase primary language subtag
 */
function extractPrimaryLang(lang?: string): string {
  const normalized = normalizeLangTag(lang);
  return normalized ? normalized.split('-')[0] : '';
}

/**
 * Resolve a natural language code to its preferred BCP-47 speech locale.
 *
 * @param lang - natural language code (e.g. `en`, `zh`) or BCP-47 locale
 * @returns BCP-47 locale string, or empty string when unspecified
 */
export function resolveSpeechLocale(lang?: string): string {
  const trimmed = (lang ?? '').trim().replace(/_/g, '-');
  if (!trimmed) {
    return '';
  }
  const lower = trimmed.toLowerCase();
  return SPEECH_LOCALES[lower] ?? trimmed;
}

/**
 * Convert Markdown response text into clean plain text suitable for speech synthesis.
 *
 * @param markdown - raw Markdown string
 * @returns cleaned plain text preserving paragraph breaks
 */
export function markdownToSpeechText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*?)\|[ \t]*$/gm, (_, row: string) => row.replace(/\s*\|\s*/g, ', '))
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/(\*\*\*|___)([^*\n_]+?)\1/g, '$2')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|[^\w])(\*|_)([^*_\n]+)\2(?=[^\w]|$)/g, '$1$3')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split an overlong sentence by clause boundaries or whitespace while staying within `maxLength`.
 *
 * @param segment - single sentence longer than `maxLength`
 * @param maxLength - maximum length per chunk
 * @returns ordered non-empty chunks
 */
function splitLongSegment(segment: string, maxLength: number): string[] {
  const result: string[] = [];
  let remaining = segment.trim();

  while (remaining.length > maxLength) {
    const windowText = remaining.slice(0, maxLength);
    let splitAt = -1;

    // Prefer clause punctuation first, then spaces.
    for (const pattern of [/[,，、:;：；]\s*/g, /\s+/g]) {
      let match: RegExpExecArray | null;
      let lastEnd = -1;
      while ((match = pattern.exec(windowText)) !== null) {
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd >= Math.floor(maxLength * 0.35)) {
        splitAt = lastEnd;
        break;
      }
    }

    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    const piece = remaining.slice(0, splitAt).trim();
    if (piece) {
      result.push(piece);
    }
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    result.push(remaining);
  }
  return result;
}

/**
 * Split plain text into natural sentence-sized chunks for reliable Web Speech playback.
 *
 * @param text - plain text to speak
 * @param maxLength - soft maximum characters per utterance chunk
 * @returns ordered non-empty speech chunks
 */
export function splitSpeechChunks(text: string, maxLength = DEFAULT_CHUNK_MAX_LENGTH): string[] {
  const cleaned = text.trim();
  if (!cleaned) {
    return [];
  }

  const chunks: string[] = [];
  const paragraphs = cleaned.split(/\n+/);

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) {
      continue;
    }

    // Split on CJK sentence terminators immediately, and on Latin/Arabic terminators followed by whitespace or end.
    const sentences = trimmedParagraph
      .split(/(?<=[。！？；])|(?<=[.!?;؟])(?:\s+|$)/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    let buffer = '';
    for (const sentence of sentences) {
      if (sentence.length > maxLength) {
        if (buffer) {
          chunks.push(buffer);
          buffer = '';
        }
        chunks.push(...splitLongSegment(sentence, maxLength));
        continue;
      }

      const separator = buffer && !/[。！？；]$/.test(buffer) ? ' ' : '';
      const candidate = buffer ? `${buffer}${separator}${sentence}` : sentence;
      if (candidate.length <= maxLength) {
        buffer = candidate;
      } else {
        if (buffer) {
          chunks.push(buffer);
        }
        buffer = sentence;
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }
  }

  return chunks;
}

/**
 * Minimal voice metadata used for ranking and testability.
 */
export type SpeechVoiceInfo = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default' | 'localService' | 'voiceURI'>;

/**
 * Score a candidate voice for the requested locale.
 *
 * @param voice - candidate speech synthesis voice
 * @param preferredLocale - normalized target locale (e.g. `en-us`)
 * @param preferLocal - whether local voices should be preferred over online voices (e.g. offline mode)
 * @returns numeric preference score
 */
function scoreVoice(voice: SpeechVoiceInfo, preferredLocale: string, preferLocal: boolean): number {
  const voiceLang = normalizeLangTag(voice.lang);
  const baseName = voice.name.trim().toLowerCase();
  const baseNameNoLocale = baseName.replace(/\s*\([^)]*\)\s*$/, '').trim();
  let score = 0;

  if (preferredLocale && voiceLang === preferredLocale) {
    score += 50;
  } else if (preferredLocale === 'zh-cn' && (voiceLang.startsWith('zh-hans') || voiceLang === 'zh')) {
    score += 40;
  }

  if (preferLocal) {
    score += voice.localService ? 60 : -80;
  } else if (/\b(natural|online)\b/i.test(voice.name)) {
    // Prefer neural / online natural voices on Windows WebView2 when online.
    score += 40;
  }

  if (/\b(premium|enhanced|siri)\b/i.test(voice.name) || /\b(premium|enhanced|siri)\b/i.test(voice.voiceURI)) {
    score += 35;
  }

  if (voice.default) {
    score += 10;
  }
  if (!preferLocal && voice.localService) {
    score += 5;
  }

  if (NOVELTY_VOICE_NAMES.has(baseName) || NOVELTY_VOICE_NAMES.has(baseNameNoLocale)) {
    score -= 100;
  }
  if (/\bcompact\b/i.test(voice.name) || /\.compact\./i.test(voice.voiceURI)) {
    score -= 20;
  }

  return score;
}

/**
 * Choose the highest-quality voice matching the target language.
 *
 * @param voices - available system/browser voices
 * @param lang - target language code or BCP-47 locale
 * @param preferLocal - whether local voices should be preferred over online voices
 * @returns best matching voice, or null when no voice matches the language
 */
export function selectBestVoice<T extends SpeechVoiceInfo>(
  voices: readonly T[],
  lang?: string,
  preferLocal = false
): T | null {
  const preferredLocale = normalizeLangTag(resolveSpeechLocale(lang));
  const primaryLang = extractPrimaryLang(preferredLocale);
  if (!primaryLang) {
    return null;
  }

  const candidates = voices.filter((voice) => extractPrimaryLang(voice.lang) === primaryLang);
  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0];
  let bestScore = scoreVoice(best, preferredLocale, preferLocal);

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateScore = scoreVoice(candidate, preferredLocale, preferLocal);
    if (candidateScore > bestScore || (candidateScore === bestScore && candidate.name.localeCompare(best.name) < 0)) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return best;
}

/** Callbacks notified during speech playback. */
export type SpeechCallbacks = {
  /** Called once playback starts. */
  onStart?: () => void;
  /** Called when playback finishes or is stopped. */
  onEnd?: () => void;
  /** Called when playback cannot start or fails unexpectedly. */
  onError?: (reason: 'unsupported' | 'no-voice' | 'error') => void;
};

/**
 * Create a Web Speech synthesis controller with lazy voice warm-up, chunked playback,
 * offline/local fallback, and stale-session protection.
 *
 * @returns controller with `warmUp`, `speak`, `stop`, and `destroy` methods
 */
export function createSpeechController() {
  const synth =
    typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
      ? window.speechSynthesis
      : null;

  let initialized = false;
  let cachedVoices: SpeechSynthesisVoice[] = [];
  let sessionId = 0;
  // Keep a strong reference to the active utterance so WebKit/Chromium cannot GC it mid-playback.
  let activeUtterance: SpeechSynthesisUtterance | null = null;
  let activeCallbacks: SpeechCallbacks | null = null;
  let cancelPendingVoiceWait: (() => void) | null = null;

  function refreshVoices(): SpeechSynthesisVoice[] {
    if (!synth) {
      return [];
    }
    const voices = synth.getVoices();
    // Ignore spurious empty `voiceschanged` notifications emitted by macOS WKWebView.
    if (voices.length > 0) {
      cachedVoices = voices;
    }
    return cachedVoices;
  }

  const handleVoicesChanged = () => {
    refreshVoices();
  };

  function warmUp() {
    if (!synth || initialized) {
      return;
    }
    initialized = true;
    refreshVoices();
    synth.addEventListener?.('voiceschanged', handleVoicesChanged);
  }

  async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
    warmUp();
    const existing = refreshVoices();
    if (existing.length > 0 || !synth) {
      return existing;
    }

    return await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        cancelPendingVoiceWait = null;
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', onVoices);
        resolve(refreshVoices());
      };
      const onVoices = () => {
        if (refreshVoices().length > 0) {
          finish();
        }
      };
      const timer = setTimeout(finish, VOICES_WAIT_TIMEOUT_MS);
      cancelPendingVoiceWait = finish;
      synth.addEventListener?.('voiceschanged', onVoices);
    });
  }

  function clearActiveUtterance() {
    if (activeUtterance) {
      activeUtterance.onstart = null;
      activeUtterance.onend = null;
      activeUtterance.onerror = null;
      activeUtterance = null;
    }
  }

  function stop() {
    sessionId += 1;
    const hadActivity = activeUtterance !== null || activeCallbacks !== null || cancelPendingVoiceWait !== null;
    cancelPendingVoiceWait?.();
    clearActiveUtterance();
    const callbacks = activeCallbacks;
    activeCallbacks = null;
    if (hadActivity) {
      synth?.cancel();
      callbacks?.onEnd?.();
    }
  }

  async function speak(markdown: string, lang?: string, callbacks?: SpeechCallbacks): Promise<boolean> {
    if (!synth) {
      callbacks?.onError?.('unsupported');
      return false;
    }

    const plainText = markdownToSpeechText(markdown);
    const chunks = splitSpeechChunks(plainText);
    if (chunks.length === 0) {
      return false;
    }

    stop();
    const currentSession = ++sessionId;
    activeCallbacks = callbacks ?? null;

    const voices = await loadVoices();
    if (currentSession !== sessionId) {
      return false;
    }

    const locale = resolveSpeechLocale(lang);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    let voice = selectBestVoice(voices, lang, offline);
    // When system voices are loaded and none match the requested language, report unavailability clearly.
    if (voices.length > 0 && locale && !voice) {
      activeCallbacks = null;
      callbacks?.onError?.('no-voice');
      return false;
    }

    let started = false;
    let triedLocalFallback = false;

    const speakChunk = (index: number) => {
      if (currentSession !== sessionId) {
        return;
      }
      if (index >= chunks.length) {
        clearActiveUtterance();
        activeCallbacks = null;
        callbacks?.onEnd?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (locale) {
        utterance.lang = locale;
      }

      utterance.onstart = () => {
        if (currentSession !== sessionId || started) {
          return;
        }
        started = true;
        callbacks?.onStart?.();
      };

      utterance.onend = () => {
        if (currentSession !== sessionId) {
          return;
        }
        speakChunk(index + 1);
      };

      utterance.onerror = (event) => {
        if (currentSession !== sessionId) {
          return;
        }
        // If an online voice fails before playback starts (e.g. blocked network), retry with a local voice.
        if (
          !started &&
          !triedLocalFallback &&
          voice &&
          !voice.localService &&
          event.error !== 'canceled' &&
          event.error !== 'interrupted'
        ) {
          const localFallback = selectBestVoice(
            voices.filter((candidate) => candidate.localService),
            lang,
            true
          );
          if (localFallback) {
            triedLocalFallback = true;
            voice = localFallback;
            clearActiveUtterance();
            synth.cancel();
            speakChunk(index);
            return;
          }
        }

        clearActiveUtterance();
        activeCallbacks = null;
        callbacks?.onEnd?.();
        // External OS interruptions should reset state without alerting an error.
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          callbacks?.onError?.('error');
        }
      };

      activeUtterance = utterance;
      // Guard against Chromium/WebView2 remaining stuck in a paused state across sleep/focus cycles.
      if (synth.paused) {
        synth.resume();
      }
      synth.speak(utterance);
    };

    speakChunk(0);
    return true;
  }

  function destroy() {
    stop();
    if (initialized) {
      initialized = false;
      synth?.removeEventListener?.('voiceschanged', handleVoicesChanged);
    }
  }

  return { warmUp, speak, stop, destroy };
}
