import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUSSIAN_DICTIONARY_READY,
  RUSSIAN_DICTIONARY_SIZE,
  RUSSIAN_DICTIONARY_MIN_SIZE,
  isKnownRussianWord,
  validateGuessInput,
} from "../src/lib/words.js";

const dictionaryPath = join(process.cwd(), "src/data/russian-words.txt");
const dictionaryWords = readFileSync(dictionaryPath, "utf8")
  .split(/\r?\n/)
  .map((word) => word.trim())
  .filter(Boolean);

const requiredWords = [
  "мама",
  "кошка",
  "привет",
  "дом",
  "слово",
  "человек",
  "победа",
];
const failures = [];

if (!RUSSIAN_DICTIONARY_READY) {
  failures.push(`dictionary has ${RUSSIAN_DICTIONARY_SIZE} words, expected at least ${RUSSIAN_DICTIONARY_MIN_SIZE}`);
}

if (dictionaryWords.length !== RUSSIAN_DICTIONARY_SIZE) {
  failures.push(`dictionary file has ${dictionaryWords.length} words, loader has ${RUSSIAN_DICTIONARY_SIZE}`);
}

for (const word of requiredWords) {
  if (!isKnownRussianWord(word)) {
    failures.push(`missing required word: ${word}`);
  }
}

const invalid = validateGuessInput("дом1");
if (invalid.ok) {
  failures.push("invalid word with digit was accepted");
}

const unknown = validateGuessInput("несуществующаяформа");
if (unknown.ok) {
  failures.push("unknown dictionary word was accepted");
}

const randomWords = [];
const seenIndexes = new Set();
while (randomWords.length < 100 && seenIndexes.size < dictionaryWords.length) {
  const index = Math.floor(Math.random() * dictionaryWords.length);
  if (seenIndexes.has(index)) continue;
  seenIndexes.add(index);
  randomWords.push(dictionaryWords[index]);
}

for (const word of randomWords) {
  const validation = validateGuessInput(word);
  if (!validation.ok || !isKnownRussianWord(word)) {
    failures.push(`random dictionary word failed validation: ${word}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  words: RUSSIAN_DICTIONARY_SIZE,
  minWords: RUSSIAN_DICTIONARY_MIN_SIZE,
  randomChecked: randomWords.length,
  sample: randomWords.slice(0, 10),
  strict: true,
}));
