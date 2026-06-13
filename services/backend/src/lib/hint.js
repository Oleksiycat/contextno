import axios from "axios";
import { prisma } from "./prisma.js";
import { getRandomRussianWords, normalizeWord } from "./words.js";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8001";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

function pickClosestCandidate(ranked, targetRank) {
  return ranked.reduce((best, item) => {
    if (!best) return item;
    return Math.abs(item.rank - targetRank) < Math.abs(best.rank - targetRank) ? item : best;
  }, null);
}

async function getCurrentBestRank(roundId) {
  if (!roundId) return Number.POSITIVE_INFINITY;

  const aggregate = await prisma.message.aggregate({
    where: { roundId, score: { not: null } },
    _min: { score: true },
  });

  return aggregate._min.score ?? Number.POSITIVE_INFINITY;
}

async function getHintCandidates(secret, roundId) {
  const usedWords = new Set([normalizeWord(secret)]);

  if (roundId) {
    const messages = await prisma.message.findMany({
      where: { roundId },
      select: { text: true },
    });

    for (const message of messages) {
      usedWords.add(normalizeWord(message.text));
    }
  }

  return getRandomRussianWords(320, usedWords)
    .filter((word) => word.length >= 4 && word.length <= 14)
    .slice(0, 120);
}

export async function selectHintWord({ secret, roundId = null }) {
  const cleanSecret = normalizeWord(secret);
  if (!cleanSecret) return "";

  const candidates = await getHintCandidates(cleanSecret, roundId);
  if (!candidates.length) return "";

  try {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}/rank_batch`,
      { secret: cleanSecret, guesses: candidates },
      { timeout: AI_TIMEOUT_MS },
    );

    const ranked = Array.isArray(data)
      ? data.filter((item) => item?.word && typeof item.rank === "number")
      : [];

    if (!ranked.length) return candidates[0];

    const currentBest = await getCurrentBestRank(roundId);
    const betterThanCurrent = ranked.filter((item) => item.rank > 1 && item.rank < currentBest);
    const pool = betterThanCurrent.length ? betterThanCurrent : ranked.filter((item) => item.rank > 1);
    const source = pool.length ? pool : ranked;

    const targetRank = Number.isFinite(currentBest) && currentBest !== Number.POSITIVE_INFINITY
      ? Math.max(2, currentBest * 0.8)
      : source[Math.floor(source.length * 0.35)]?.rank || source[0].rank;

    return (pickClosestCandidate(source, targetRank) || source[0] || ranked[0])?.word || candidates[0];
  } catch (error) {
    console.error("[Hint] AI ranking failed:", error.message);
    return candidates[0];
  }
}
