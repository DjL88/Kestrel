/**
 * The wording audit: checks every language's words for the three things owner decision 10 asks for.
 *
 *  1. Complete: every phrase in the British English source has a translation in every full language.
 *  2. Not left in English: a translation that is the English sentence copied across is caught.
 *  3. Plain: sentences stay short and words stay everyday, with a bar set per language
 *     (German, Dutch, the Nordic languages, Finnish and Icelandic build long compound words, so their word bar is higher).
 *
 * It also reports how the photography words (flag and pick, exposure, mask, noise, burst, keeper) are rendered in each
 * language, so a native reviewer can see where a dictionary meaning might have slipped in. That report is a reading aid,
 * never proof of quality: every non-English language is still a draft until a native speaker has checked it.
 *
 * Pure functions only: callers pass in the areas (name, source, translations) and the language list.
 */

/**
 * A sample value for phrases that are functions, so their finished text can be read. It reads as the number in text
 * and sums, and any field read from it (`f.share`, `figures.count`) is another sample, so phrases that take an object
 * of figures are filled in too rather than showing "undefined".
 */
function sample(value) {
  return new Proxy(Object(value), {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'string' ? String(value) : value);
      if (prop === 'toString') return () => String(value);
      if (prop === 'valueOf') return () => value;
      if (typeof prop === 'symbol') return undefined;
      if (prop in Number.prototype) return Number.prototype[prop].bind(value);
      return sample(value);
    },
  });
}
const SAMPLE_ARGS = [7, 3, 12, 5, 2].map(sample);

/** Every phrase in an area as `path → text`. Phrase functions are called with sample values. */
export function flattenWords(value, prefix = '', out = new Map()) {
  if (typeof value === 'string') out.set(prefix, value);
  else if (typeof value === 'function') {
    try {
      const text = value(...SAMPLE_ARGS.slice(0, Math.max(value.length, 1)));
      if (typeof text === 'string') out.set(prefix, text);
    } catch { /* a phrase that needs a richer argument is skipped, never guessed */ }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) flattenWords(value[key], prefix ? `${prefix}.${key}` : key, out);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenWords(item, `${prefix}[${index}]`, out));
  }
  return out;
}

/** Paths of every leaf (string, function or array item) in the source. */
function leafPaths(value, prefix = '', out = []) {
  if (typeof value === 'string' || typeof value === 'function') out.push(prefix);
  else if (Array.isArray(value)) value.forEach((item, index) => leafPaths(item, `${prefix}[${index}]`, out));
  else if (value && typeof value === 'object') for (const key of Object.keys(value)) leafPaths(value[key], prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function at(value, path) {
  let node = value;
  for (const part of path.split(/\.|(?=\[)/)) {
    if (node == null) return undefined;
    const index = /^\[(\d+)\]$/.exec(part);
    node = index ? node[Number(index[1])] : node[part];
  }
  return node;
}

/** A full language has its own file for everything; English variants and regional languages (fr-CA) override only what differs. */
export function isFullLanguage(code) {
  return !code.startsWith('en') && !code.includes('-');
}

/**
 * Phrases a full language leaves in British English: the key is absent, empty, or the wrong kind
 * (a sentence where the source has a phrase function, or the other way round).
 * `exempt(area, path)` skips phrases that belong to screens being retired.
 */
export function findMissing(areas, languages, exempt = () => false) {
  const missing = [];
  for (const area of areas) {
    const paths = leafPaths(area.source);
    for (const code of languages) {
      if (!isFullLanguage(code)) continue;
      const translation = area.translations[code];
      for (const path of paths) {
        if (exempt(area.name, path)) continue;
        const want = at(area.source, path);
        const have = translation ? at(translation, path) : undefined;
        const ok = typeof have === typeof want && (typeof have !== 'string' || have.trim().length > 0 || want.trim().length === 0);
        if (!ok) missing.push({ area: area.name, code, key: path });
      }
    }
  }
  return missing;
}

/** Short English words that almost never appear in the other languages, so a sentence holding them is English. */
const ENGLISH_WORDS = /\b(?:the|and|with|your|this|that|these|those|to|of|is|are|for|from|you|not|will|it|be|on|can|could|into|was|or|has|have|been|which|when|while|there|here|what|only|than|then|they|their|our|we|any|each|every|about|after|before)\b/i;

/** Words that are the same in many languages, or names, and so may stay as they are. */
const SHARED_TERMS = /^(?:InFlight|Kestrel|RAW|JPEG|PNG|TIFF|HEIC|DNG|EXIF|IPTC|XMP|ICC|sRGB|P3|HDR|EV|ISO|OK|Wi-?Fi|NAS|S3|WebDAV|SMB|URL|USB|GPU|CPU|RAM|ONNX|YOLOX|RF-DETR|Adobe|Lightroom|Photoshop|Capture One|Google|Apple|Microsoft|Anthropic|Claude|Gemini|Ollama|Windows|macOS|iOS|Android|Linux|Instagram|Facebook)$/i;

/**
 * Translations that are word for word the British English sentence. A single shared word ("Zoom", "Original") is allowed;
 * a sentence with English function words in it ("Keep the photo") is not.
 */
export function findLeftInEnglish(areas, languages, exempt = () => false) {
  const found = [];
  for (const area of areas) {
    const source = flattenWords(area.source);
    for (const code of languages) {
      if (!isFullLanguage(code)) continue;
      const translated = flattenWords(area.translations[code] ?? {});
      for (const [key, text] of translated) {
        if (exempt(area.name, key) || source.get(key) !== text) continue;
        const words = text.split(/\s+/).filter((word) => /\p{L}{2}/u.test(word) && !SHARED_TERMS.test(word.replace(/[^\p{L}\d-]/gu, '')));
        if (words.length >= 2 && ENGLISH_WORDS.test(text)) found.push({ area: area.name, code, key, text });
      }
    }
  }
  return found;
}

/**
 * The plain-language bar for each language: the most words in one sentence, and the longest everyday word.
 * Translations run longer than English (French and the Celtic languages by about a quarter), and compounding languages
 * write one long word where English writes three short ones, so a single bar for all would punish correct grammar.
 * Irish allows 21 letters because the everyday word for "of photography", grianghrafadóireachta, has 21.
 */
export const PLAIN_BAR = {
  'en-GB': { sentenceWords: 25, wordLetters: 16 },
  fr: { sentenceWords: 32, wordLetters: 17 }, es: { sentenceWords: 32, wordLetters: 17 },
  it: { sentenceWords: 32, wordLetters: 17 }, pt: { sentenceWords: 32, wordLetters: 17 },
  cy: { sentenceWords: 32, wordLetters: 18 }, gd: { sentenceWords: 34, wordLetters: 18 }, ga: { sentenceWords: 34, wordLetters: 21 },
  de: { sentenceWords: 28, wordLetters: 24 }, nl: { sentenceWords: 28, wordLetters: 24 },
  da: { sentenceWords: 28, wordLetters: 24 }, sv: { sentenceWords: 28, wordLetters: 24 }, nb: { sentenceWords: 28, wordLetters: 24 },
  fi: { sentenceWords: 25, wordLetters: 24 }, is: { sentenceWords: 25, wordLetters: 24 },
};

/** Text that should never reach a person: code names, empty values and unfilled placeholders. */
const DEVELOPER_TEXT = [
  { pattern: /\b(?:undefined|null|NaN)\b|\[object Object\]/, why: 'an empty or broken value is shown' },
  { pattern: /\$\{[^}]*\}/, why: 'a placeholder was never filled in' },
  // Three or more lower-case letters before a capital: Irish mutations (dTionscadal, bhFón) have one or two, so they pass.
  { pattern: /\b(?:[a-z]{3,}[A-Z]|[a-z]+[A-Z][a-z]+[A-Z])[a-zA-Z]*\b/, why: 'a code name (camelCase) is shown' },
  { pattern: /\b[A-Z][a-z]+[A-Z][a-z]+[A-Za-z]*\b/, why: 'a code name (PascalCase) is shown' },
];
/** Product and brand names written in mixed case, with any case ending a language adds (InFlights, OneDrivessa). */
const ALLOWED_CODE_LIKE = /\b(?:InFlight|sRGB|ownCloud|NextCloud|SinLoon|TourBox|iPhone|iPad|iOS|macOS|WebDAV|OneDrive|iCloud|PowerShell|GitHub|YouTube|LinkedIn|PayPal|DeepSeek|OpenAI|JavaScript|TrueDetail|ColourSense|RawTherapee|DxO|PhotoLab|PureRAW|eBird|BirdNET|MobileNet|ResNet|ConvNeXt|SigLIP|DeepPRIME|FastStone|PhotoMechanic|ExifTool|LibRaw|WebGPU|WebGL|McDonald|MacBook|DropBox|GoPro)\p{L}*/gu;

/** A sentence-length, word-length or developer-text problem in one phrase, judged against the language's bar. */
export function plainProblems(text, code) {
  // English variants use the English bar; a regional language (fr-CA) uses its parent's.
  const bar = PLAIN_BAR[code] ?? PLAIN_BAR[code.split('-')[0]] ?? PLAIN_BAR['en-GB'];
  const problems = [];
  const prose = text.replace(/https?:\/\/\S+/g, '').replace(/\{[a-z]+\}/gi, 'N');
  for (const sentence of prose.split(/(?<=[.!?;:])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter((word) => /\p{L}|\d/u.test(word));
    if (words.length > bar.sentenceWords) problems.push({ kind: 'sentence', words: words.length, limit: bar.sentenceWords, sentence: sentence.slice(0, 120) });
  }
  for (const raw of prose.split(/[\s/–—\-·(),.:;'"’‘“”«»!?+=]+/)) {
    const word = raw.replace(/[^\p{L}]/gu, '');
    // Names and labels in capitals keep their spelling; the bar is for everyday words. German writes every noun with a
    // capital, so there a capital says nothing and every word is measured.
    const name = code !== 'de' && /^\p{Lu}/u.test(word);
    if (word.length > bar.wordLetters && !name) problems.push({ kind: 'word', word, letters: word.length, limit: bar.wordLetters });
  }
  const unnamed = text.replace(ALLOWED_CODE_LIKE, '');
  for (const { pattern, why } of DEVELOPER_TEXT) {
    const hit = pattern.exec(unnamed);
    if (hit) problems.push({ kind: 'developer', token: hit[0], why });
  }
  return problems;
}

/**
 * Plain-language problems in the source and every language's own words: a full language's translation, and the phrases
 * an English variant (en-US) or regional language (fr-CA) rewrites for itself.
 */
export function findNotPlain(areas, languages, exempt = () => false) {
  const found = [];
  for (const area of areas) {
    for (const code of ['en-GB', ...languages.filter((code) => code !== 'en-GB')]) {
      const words = flattenWords(code === 'en-GB' ? area.source : area.translations[code] ?? {});
      for (const [key, text] of words) {
        if (exempt(area.name, key)) continue;
        for (const problem of plainProblems(text, code)) found.push({ area: area.name, code, key, ...problem });
      }
    }
  }
  return found;
}

/**
 * How each photography word is rendered. For every source phrase that uses the word, the language's phrase is checked
 * for its expected photographic word(s) and for known dictionary-sense slips. `wrong` hits are definite mistakes;
 * `check` rows (none of the expected words found) are for a native reviewer and are not failures on their own.
 */
export function photoTermReport(areas, languages, glossary) {
  const report = {};
  for (const [term, entry] of Object.entries(glossary)) {
    const rows = { uses: 0, perLanguage: {} };
    for (const area of areas) {
      const source = flattenWords(area.source);
      for (const [key, text] of source) {
        if (!entry.source.test(text)) continue;
        rows.uses += 1;
        for (const code of languages) {
          if (!isFullLanguage(code)) continue;
          const lang = entry.languages[code];
          if (!lang) continue;
          const translated = flattenWords(area.translations[code] ?? {}).get(key);
          if (translated === undefined) continue;
          const bucket = (rows.perLanguage[code] ??= { expected: lang.expected, question: lang.question, checked: 0, wrong: [], check: [] });
          bucket.checked += 1;
          const lower = translated.toLocaleLowerCase(code);
          const wrong = (lang.wrong ?? []).find((word) => lower.includes(word));
          if (wrong) bucket.wrong.push({ area: area.name, key, text: translated, word: wrong, note: lang.why });
          else if (!lang.expected.some((word) => lower.includes(word))) bucket.check.push({ area: area.name, key, source: text, text: translated });
        }
      }
    }
    report[term] = rows;
  }
  return report;
}

/** The whole wording audit. `failures` counts what must be fixed before a merge; the terms report is advice. */
export function runWordingAudit(areas, languages, { glossary, exempt } = {}) {
  const missing = findMissing(areas, languages, exempt);
  const leftInEnglish = findLeftInEnglish(areas, languages, exempt);
  const notPlain = findNotPlain(areas, languages, exempt);
  const terms = glossary ? photoTermReport(areas, languages, glossary) : {};
  const wrongTerms = Object.entries(terms).flatMap(([term, rows]) =>
    Object.entries(rows.perLanguage).flatMap(([code, bucket]) => bucket.wrong.map((hit) => ({ term, code, ...hit }))));
  const perLanguage = {};
  for (const code of ['en-GB', ...languages.filter((code) => code !== 'en-GB')]) {
    perLanguage[code] = {
      missing: missing.filter((item) => item.code === code).length,
      leftInEnglish: leftInEnglish.filter((item) => item.code === code).length,
      notPlain: notPlain.filter((item) => item.code === code).length,
      wrongTerms: wrongTerms.filter((item) => item.code === code).length,
      termsToCheck: Object.values(terms).reduce((sum, rows) => sum + (rows.perLanguage[code]?.check.length ?? 0), 0),
    };
  }
  return {
    failures: missing.length + leftInEnglish.length + notPlain.length + wrongTerms.length,
    perLanguage, missing, leftInEnglish, notPlain, wrongTerms, terms,
  };
}
