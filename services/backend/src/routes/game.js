import { Router } from "express";
import { memoryStore } from "../services/tiktok.js";
import { tiktokService } from "../index.js";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, sendError } from "../lib/http.js";
import { validateGuessInput } from "../lib/words.js";
import { selectHintWord } from "../lib/hint.js";

const router = Router();

const GUESS_ERROR_MESSAGES = {
  missing_room: "Не выбрана комната.",
  no_active_round: "Раунд не запущен.",
  invalid_word: "Слово не принято.",
  ai_unavailable: "AI-сервис пока не ответил. Подожди загрузку модели и попробуй еще раз.",
  waiting_for_starter: "Первое слово должен ввести web_user или победитель прошлого раунда.",
  duplicate_word: "Это слово уже было введено в этом раунде.",
};

function sendGuessError(res, status, reason, fallbackMessage) {
  const error = GUESS_ERROR_MESSAGES[reason] || fallbackMessage || "Слово не удалось отправить.";
  return res.status(status).json({ error, reason });
}

router.get("/leaderboard", asyncRoute(async (_, res) => {
  const users = await prisma.user.findMany({
    orderBy: { points: "desc" },
    take: 50,
    select: { tiktokUsername: true, points: true, wins: true, league: true, streak: true },
  });

  res.json(users);
}));

router.get("/winners/recent", asyncRoute(async (_, res) => {
  const winners = await prisma.winner.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: true, round: { include: { word: true } } },
  });

  res.json(winners);
}));

router.get("/state", asyncRoute(async (req, res) => {
  const roomId = String(req.query?.roomId || "").trim();
  if (!roomId) return sendError(res, 400, "Missing roomId");

  const roundJson = await memoryStore.get(`round:${roomId}`);
  if (!roundJson) return res.json({ round: null, guesses: [] });

  let activeRound;
  try {
    activeRound = JSON.parse(roundJson);
  } catch {
    await memoryStore.del(`round:${roomId}`);
    return res.json({ round: null, guesses: [] });
  }

  const round = await prisma.round.findUnique({
    where: { id: activeRound.id },
    include: { word: true },
  });

  if (!round) return res.json({ round: null, guesses: [] });

  const messages = await prisma.message.findMany({
    where: { roundId: round.id },
    orderBy: { createdAt: "asc" },
    include: { user: true },
  });

  res.json({
    round: {
      id: round.id,
      roomId: round.roomId,
      hint: round.hint,
      startedAt: round.startedAt,
    },
    guesses: messages.map((message) => ({
      username: message.user.tiktokUsername,
      word: message.score <= 1 ? "*****" : message.text,
      rank: message.score,
    })),
  });
}));

router.post("/hint", asyncRoute(async (req, res) => {
  const roomId = String(req.body?.roomId || "").trim();
  if (!roomId) return sendError(res, 400, "Missing roomId");

  const roundJson = await memoryStore.get(`round:${roomId}`);
  if (!roundJson) return sendError(res, 400, "Раунд не запущен.");

  let activeRound;
  try {
    activeRound = JSON.parse(roundJson);
  } catch {
    await memoryStore.del(`round:${roomId}`);
    return sendError(res, 400, "Раунд не запущен.");
  }

  const hintWord = await selectHintWord({ secret: activeRound.word, roundId: activeRound.id });
  if (!hintWord) return sendError(res, 400, "Не удалось подобрать подсказку.");

  const result = await tiktokService.processGuess(roomId, "hint_bot", hintWord);
  if (!result?.ok) {
    return sendError(res, 400, GUESS_ERROR_MESSAGES[result?.reason] || "Не удалось добавить подсказку.");
  }

  res.json({ ...result.guess, hint: true });
}));

router.post("/guess", asyncRoute(async (req, res) => {
  const roomId = String(req.body?.roomId || "").trim();
  const username = String(req.body?.username || "web_user").trim() || "web_user";
  const validation = validateGuessInput(req.body?.word);

  if (!roomId) return sendGuessError(res, 400, "missing_room");
  if (!validation.ok) {
    return res.status(400).json({
      error: validation.error,
      reason: "invalid_word",
    });
  }

  const dupKey = `dup:${roomId}:${validation.word}`;
  const isDup = await memoryStore.get(dupKey);
  if (isDup) return sendGuessError(res, 400, "duplicate_word");

  await memoryStore.set(dupKey, "1", "EX", 30);

  const guessData = await tiktokService.processGuess(roomId, username, validation.word);
  if (!guessData?.ok) {
    await memoryStore.del(dupKey);
    return sendGuessError(res, 400, guessData?.reason, "Раунд не запущен или слово не принято.");
  }

  res.json(guessData.guess);
}));

export { router as gameRouter };
