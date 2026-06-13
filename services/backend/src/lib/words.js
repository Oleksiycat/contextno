import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICTIONARY_PATH = join(__dirname, "../data/russian-words.txt");
const CYRILLIC_WORD_RE = /^\p{Script=Cyrillic}+$/u;
const LATIN_WORD_RE = /^[a-z]+$/i;
const WORD_RE = /^[\p{Script=Cyrillic}a-z]+$/iu;
const WORD_TOKEN_RE = /[\p{Script=Cyrillic}a-z]+/iu;
const MIN_DICTIONARY_WORDS = 100000;

function loadRussianDictionary() {
  const content = readFileSync(DICTIONARY_PATH, "utf8");
  const words = content
    .split(/\r?\n/)
    .map((word) => normalizeWord(word))
    .filter((word) => word && CYRILLIC_WORD_RE.test(word));

  return new Set(words);
}

export const RUSSIAN_WORDS = [...loadRussianDictionary()];
const ruDict = new Set(RUSSIAN_WORDS);

export const RUSSIAN_DICTIONARY_SIZE = ruDict.size;
export const RUSSIAN_DICTIONARY_UNIQUE_SIZE = ruDict.size;
export const RUSSIAN_DICTIONARY_MIN_SIZE = MIN_DICTIONARY_WORDS;
export const RUSSIAN_DICTIONARY_READY = RUSSIAN_DICTIONARY_SIZE >= MIN_DICTIONARY_WORDS;

export function normalizeWord(value) {
  const match = String(value || "").match(WORD_TOKEN_RE);
  return String(match ? match[0] : "")
    .toLocaleLowerCase("ru")
    .replace(/\u0451/g, "\u0435");
}

export function isValidWord(value) {
  return WORD_RE.test(value);
}

export function isRussianWord(value) {
  return CYRILLIC_WORD_RE.test(value);
}

export function isLatinWord(value) {
  return LATIN_WORD_RE.test(value);
}

export function isKnownRussianWord(value) {
  const word = normalizeWord(value);
  return isRussianWord(word) && ruDict.has(word);
}

export function isAllowedGuess(value) {
  const word = normalizeWord(value);
  return Boolean(word) && word.length >= 2 && word.length <= 40 && isKnownRussianWord(word);
}

export function getRandomRussianWords(count, excludedWords = new Set()) {
  const excluded = new Set([...excludedWords].map((word) => normalizeWord(word)));
  const result = [];
  const seenIndexes = new Set();

  while (result.length < count && seenIndexes.size < RUSSIAN_WORDS.length) {
    const index = Math.floor(Math.random() * RUSSIAN_WORDS.length);
    if (seenIndexes.has(index)) continue;
    seenIndexes.add(index);

    const word = RUSSIAN_WORDS[index];
    if (!excluded.has(word)) result.push(word);
  }

  return result;
}

export function validateGuessInput(value) {
  const word = normalizeWord(value);

  if (!word) {
    return { ok: false, error: "Введите слово." };
  }

  if (word.length < 2 || word.length > 40 || !isValidWord(word)) {
    return {
      ok: false,
      error: "Только одно слово из букв, без пробелов и цифр.",
    };
  }

  if (!isKnownRussianWord(word)) {
    return {
      ok: false,
      error: "Такого слова нет в словаре.",
    };
  }

  return {
    ok: true,
    word,
    known: true,
    dictionaryReady: RUSSIAN_DICTIONARY_READY,
  };
}
