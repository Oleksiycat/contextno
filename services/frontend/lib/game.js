const WORD_RE = /^[\p{Script=Cyrillic}a-z]+$/iu;
const WORD_TOKEN_RE = /[\p{Script=Cyrillic}a-z]+/iu;

export function normalizeWord(value) {
  const match = String(value || "").match(WORD_TOKEN_RE);
  return String(match ? match[0] : "")
    .toLocaleLowerCase("ru")
    .replace(/\u0451/g, "\u0435");
}

export function isValidWord(value) {
  return WORD_RE.test(value);
}

export function validateWordInput(value) {
  const word = normalizeWord(value);

  if (!word) return { ok: false, error: "Введите слово." };
  if (word.length > 40 || !isValidWord(word)) {
    return { ok: false, error: "Только одно слово из букв, без пробелов и цифр." };
  }

  return { ok: true, word };
}

export function getColor(rank) {
  if (rank <= 500) return "green";
  if (rank <= 2000) return "orange";
  return "pink";
}

export function getHexColor(rank) {
  if (rank <= 500) return "#00ba7c";
  if (rank <= 2000) return "#ef7d31";
  return "#f91880";
}

export function getWidth(rank) {
  if (rank <= 100) return 90;
  if (rank <= 300) return 75;
  if (rank <= 700) return 55;
  if (rank <= 2000) return 35;
  if (rank <= 5000) return 20;
  return 8;
}

export function upsertGuess(list, guess, limit) {
  const guessKey = guess.secretWord || guess.word;
  const next = [
    { ...guess, isNew: true },
    ...list.filter((item) => (item.secretWord || item.word) !== guessKey),
  ];
  next.sort((a, b) => Number(a.rank) - Number(b.rank));
  return typeof limit === "number" ? next.slice(0, limit) : next;
}
