import express from "express";
import { pipeline, cos_sim } from "@xenova/transformers";
import { SEMANTIC_GROUPS } from "./semantic-groups.js";

const app = express();
const PORT = Number(process.env.AI_SERVICE_PORT || 8001);
const modelName = process.env.MODEL_NAME || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

app.use(express.json({ limit: "64kb" }));

let extractorPromise = null;
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 5000;

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

const semanticIndex = new Map();
for (const group of SEMANTIC_GROUPS) {
  for (const word of group.words) {
    const normalized = normalizeText(word);
    const groups = semanticIndex.get(normalized) || [];
    groups.push(group);
    semanticIndex.set(normalized, groups);
  }
}

function validateWord(value) {
  const word = normalizeText(value);
  return word && word.length <= 80 ? word : null;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", modelName, { quantized: true });
  }

  return extractorPromise;
}

async function embed(text) {
  if (embeddingCache.has(text)) return embeddingCache.get(text);

  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });

  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }

  embeddingCache.set(text, output);
  return output;
}

function enrichWordContext(word) {
  const groups = semanticIndex.get(word) || [];
  const categoryContexts = groups.flatMap((group) => [
    `категория ${group.label}`,
    group.context,
  ]);

  return [
    `слово ${word}`,
    `значение ${word}`,
    `контекст ${word}`,
    `${word} связано с похожими предметами действиями местами и категориями`,
    ...categoryContexts,
  ].join(". ");
}

function getSharedGroups(word1, word2) {
  const groups1 = semanticIndex.get(word1) || [];
  const groupIds2 = new Set((semanticIndex.get(word2) || []).map((group) => group.id));
  return groups1.filter((group) => groupIds2.has(group.id));
}

function adjustSimilarity(word1, word2, similarity) {
  const safeSimilarity = Math.max(0, Math.min(similarity, 1));
  if (word1 === word2) return 1;

  const sharedGroups = getSharedGroups(word1, word2);
  if (!sharedGroups.length) return safeSimilarity;

  const categoryFloor = Math.max(...sharedGroups.map((group) => group.weight || 0.82));
  const multiCategoryBonus = Math.min((sharedGroups.length - 1) * 0.015, 0.045);
  const adjusted = Math.max(safeSimilarity, categoryFloor + multiCategoryBonus);

  return Math.min(adjusted, 0.98);
}

function getSimilarityMeta(word1, word2, rawSimilarity, similarity) {
  const sharedGroups = getSharedGroups(word1, word2);

  return {
    rawSimilarity,
    categoryBoosted: similarity > rawSimilarity,
    categories: sharedGroups.map((group) => ({
      id: group.id,
      label: group.label,
      weight: group.weight,
    })),
  };
}

function classifyWord(word) {
  const groups = semanticIndex.get(word) || [];
  const rankedGroups = [...groups].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const primary = rankedGroups[0] || null;

  return {
    word,
    category: primary?.id || "general",
    categoryLabel: primary?.label || "general",
    meaning: primary?.context || "",
    categories: rankedGroups.map((group) => ({
      id: group.id,
      label: group.label,
      weight: group.weight,
      context: group.context,
    })),
  };
}

function rankFromSimilarity(similarity) {
  return Math.max(0, Math.round((1 - similarity) * 10000));
}

app.post("/similarity", async (req, res, next) => {
  try {
    const word1 = validateWord(req.body?.word1);
    const word2 = validateWord(req.body?.word2);

    if (!word1 || !word2) {
      return res.status(400).json({ error: "Missing or invalid words" });
    }

    const [output1, output2] = await Promise.all([embed(enrichWordContext(word1)), embed(enrichWordContext(word2))]);
    const rawSimilarity = cos_sim(output1.data, output2.data);
    const similarity = adjustSimilarity(word1, word2, rawSimilarity);

    res.json({
      similarity,
      rank: rankFromSimilarity(similarity),
      meta: getSimilarityMeta(word1, word2, rawSimilarity, similarity),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/word_context", async (req, res, next) => {
  try {
    const word = validateWord(req.body?.word);

    if (!word) {
      return res.status(400).json({ error: "Missing or invalid word" });
    }

    res.json(classifyWord(word));
  } catch (error) {
    next(error);
  }
});

app.post("/rank_batch", async (req, res, next) => {
  try {
    const secret = validateWord(req.body?.secret);
    const guesses = Array.isArray(req.body?.guesses) ? req.body.guesses : null;

    if (!secret || !guesses) {
      return res.status(400).json({ error: "Missing secret or guesses" });
    }

    const cleanGuesses = [...new Set(guesses.map(validateWord).filter(Boolean))].slice(0, 200);
    const secretOutput = await embed(enrichWordContext(secret));
    const results = [];

    for (const guess of cleanGuesses) {
      const guessOutput = await embed(enrichWordContext(guess));
      const rawSimilarity = cos_sim(secretOutput.data, guessOutput.data);
      const similarity = adjustSimilarity(secret, guess, rawSimilarity);
      results.push({
        word: guess,
        similarity,
        rank: rankFromSimilarity(similarity),
        meta: getSimilarityMeta(secret, guess, rawSimilarity, similarity),
      });
    }

    results.sort((a, b) => a.rank - b.rank);
    res.json(results);
  } catch (error) {
    next(error);
  }
});

app.get("/health", (_, res) => {
  res.json({ status: "ok", model: modelName });
});

app.use((error, req, res, _next) => {
  console.error(`[AI] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`AI Service running on port ${PORT}`);
});
