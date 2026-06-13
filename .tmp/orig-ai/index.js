import express from "express";
import { pipeline, cos_sim } from "@xenova/transformers";

const app = express();
const PORT = Number(process.env.PORT || 8001);
const modelName = process.env.MODEL_NAME || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

app.use(express.json({ limit: "64kb" }));

let extractorPromise = null;

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
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
  const extractor = await getExtractor();
  return extractor(text, { pooling: "mean", normalize: true });
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

    const [output1, output2] = await Promise.all([embed(word1), embed(word2)]);
    const similarity = cos_sim(output1.data, output2.data);

    res.json({ similarity, rank: rankFromSimilarity(similarity) });
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
    const secretOutput = await embed(secret);
    const results = [];

    for (const guess of cleanGuesses) {
      const guessOutput = await embed(guess);
      const similarity = cos_sim(secretOutput.data, guessOutput.data);
      results.push({ word: guess, similarity, rank: rankFromSimilarity(similarity) });
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
