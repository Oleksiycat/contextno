import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, sendError } from "../lib/http.js";
import { resolveWordContext } from "../lib/word-context.js";
import {
  normalizeWord,
  isValidWord,
  RUSSIAN_DICTIONARY_SIZE,
  RUSSIAN_DICTIONARY_UNIQUE_SIZE,
  RUSSIAN_DICTIONARY_MIN_SIZE,
  RUSSIAN_DICTIONARY_READY,
  isKnownRussianWord,
} from "../lib/words.js";

const router = Router();

router.get("/", asyncRoute(async (_, res) => {
  const words = await prisma.word.findMany({ orderBy: { text: "asc" } });
  res.json(words);
}));

router.get("/dictionary/status", (_, res) => {
  res.json({
    language: "ru",
    words: RUSSIAN_DICTIONARY_SIZE,
    normalizedUniqueWords: RUSSIAN_DICTIONARY_UNIQUE_SIZE,
    minWords: RUSSIAN_DICTIONARY_MIN_SIZE,
    ready: RUSSIAN_DICTIONARY_READY,
    strict: false,
  });
});

router.get("/dictionary/check/:word", (req, res) => {
  const word = normalizeWord(req.params.word);
  res.json({
    word,
    valid: Boolean(word) && isValidWord(word),
    known: isKnownRussianWord(word),
  });
});

router.post("/", asyncRoute(async (req, res) => {
  const text = normalizeWord(req.body?.text);
  const requestedCategory = String(req.body?.category || "").trim();
  const wordContext = await resolveWordContext(text);
  const category = wordContext.category !== "general"
    ? wordContext.category
    : (requestedCategory || wordContext.category || "general");

  if (!text || !isValidWord(text)) {
    return sendError(res, 400, "Invalid word");
  }

  const word = await prisma.word.upsert({
    where: { text },
    update: { category },
    create: { text, category },
  });

  res.status(201).json({
    ...word,
    context: wordContext,
  });
}));

router.delete("/:id", asyncRoute(async (req, res) => {
  await prisma.word.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export { router as wordRouter };
