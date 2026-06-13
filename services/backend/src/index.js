import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { gameRouter } from "./routes/game.js";
import { roomRouter } from "./routes/rooms.js";
import { wordRouter } from "./routes/words.js";
import { statsRouter } from "./routes/stats.js";
import { setupSocketHandlers, startRound } from "./socket/handlers.js";
import { TikTokService, memoryStore } from "./services/tiktok.js";
import { TwitchService } from "./services/twitch.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN || "*", methods: ["GET", "POST"] }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "64kb" }));

export const tiktokService = new TikTokService(io);
export const twitchService = new TwitchService(io, tiktokService);
setupSocketHandlers(io, tiktokService, twitchService);

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.get("/api/tiktok/status", (_, res) => {
  res.json({ connections: tiktokService.getStatus() });
});

app.get("/api/twitch/status", (_, res) => {
  res.json({ connections: twitchService.getStatus() });
});

app.get("/api/game/active-rounds", async (_, res) => {
  const keys = await memoryStore.keys("round:");
  const rounds = await Promise.all(keys.map(async (key) => {
    const value = await memoryStore.get(key);
    try {
      return { roomId: key.slice("round:".length), round: JSON.parse(value) };
    } catch {
      return { roomId: key.slice("round:".length), round: null };
    }
  }));

  res.json({ rounds });
});

app.use("/api/game", gameRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/words", wordRouter);
app.use("/api/stats", statsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, _next) => {
  console.error(`[API] ${req.method} ${req.originalUrl}`, error);
  res.status(error.status || 500).json({ error: error.publicMessage || "Internal error" });
});

const PORT = process.env.PORT || 3001;
const AUTO_START_ROOM_ID = process.env.AUTO_START_ROOM_ID || "room";
const AUTO_START_WORD = process.env.AUTO_START_WORD || "";
const AUTO_START_FIRST_GUESS = process.env.AUTO_START_FIRST_GUESS || "";
const AUTO_START_HINT = process.env.AUTO_START_HINT || "старт";

async function ensureStartupRound() {
  const existingRound = await memoryStore.get(`round:${AUTO_START_ROOM_ID}`);
  if (existingRound) return;

  const result = await startRound(io, {
    roomId: AUTO_START_ROOM_ID,
    word: AUTO_START_WORD,
    hint: AUTO_START_HINT,
  });

  if (result.ok) {
    console.log(`[Game] Auto-started first round in ${AUTO_START_ROOM_ID}`);
    if (!AUTO_START_FIRST_GUESS) return;

    const firstGuess = await tiktokService.processGuess(AUTO_START_ROOM_ID, "web_user", AUTO_START_FIRST_GUESS);
    if (firstGuess?.ok) {
      console.log(`[Game] Auto-submitted first guess "${AUTO_START_FIRST_GUESS}" as web_user`);
    } else {
      console.error("[Game] Failed to auto-submit first guess:", firstGuess?.reason || "unknown");
    }
  } else {
    console.error("[Game] Failed to auto-start first round:", result.error);
  }
}

httpServer.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`);
  ensureStartupRound().catch((error) => {
    console.error("[Game] Startup round failed:", error);
  });
});
