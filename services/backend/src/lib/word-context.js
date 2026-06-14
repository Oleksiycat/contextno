import axios from "axios";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8001";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

const FALLBACK_CONTEXT = {
  category: "general",
  categoryLabel: "general",
  meaning: "",
  categories: [],
  source: "fallback",
};

export async function resolveWordContext(word) {
  const cleanWord = String(word || "").trim().toLowerCase();
  if (!cleanWord) return { ...FALLBACK_CONTEXT };

  try {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}/word_context`,
      { word: cleanWord },
      { timeout: AI_TIMEOUT_MS },
    );

    const category = String(data?.category || "").trim() || FALLBACK_CONTEXT.category;
    return {
      category,
      categoryLabel: String(data?.categoryLabel || data?.label || category).trim() || category,
      meaning: String(data?.meaning || "").trim(),
      categories: Array.isArray(data?.categories) ? data.categories : [],
      source: "ai-service",
    };
  } catch (error) {
    console.error("[AI] word context request failed:", error.message);
    return { ...FALLBACK_CONTEXT };
  }
}
