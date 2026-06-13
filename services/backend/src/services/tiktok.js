import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { extractGuessWords, getRandomRussianWords, isAllowedGuess, normalizeWord } from "../lib/words.js";
import { selectHintWord } from "../lib/hint.js";

const DEFAULT_AI_SERVICE_URL = "http://localhost:8001";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);
const MASKED_SECRET_WORD = "*****";

function getTikTokCommentUsername(data) {
  const candidates = [
    data.uniqueId,
    data.nickname,
    data.userId,
    data.secUid,
    data.user?.uniqueId,
    data.user?.nickname,
    data.user?.userId,
    data.user?.id,
    data.author?.uniqueId,
    data.author?.nickname,
    data.author?.id,
  ];

  const username = candidates.find((value) => String(value || "").trim());
  if (username) return String(username).trim();

  const messageId = data.msgId || data.messageId || data.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `tiktok_${messageId}`;
}

export const memoryStore = {
  data: new Map(),
  timers: new Map(),

  async get(key) {
    return this.data.get(key) ?? null;
  },

  async set(key, value, mode, seconds) {
    this.data.set(key, value);
    this.clearTimer(key);

    if (mode === "EX" && Number.isFinite(seconds) && seconds > 0) {
      const timer = setTimeout(() => {
        this.data.delete(key);
        this.timers.delete(key);
      }, seconds * 1000);

      timer.unref?.();
      this.timers.set(key, timer);
    }
  },

  async incr(key) {
    const value = Number(this.data.get(key) || 0) + 1;
    this.data.set(key, value);
    return value;
  },

  async expire(key, seconds) {
    if (!this.data.has(key)) return;
    await this.set(key, this.data.get(key), "EX", seconds);
  },

  async del(key) {
    this.clearTimer(key);
    this.data.delete(key);
  },

  async keys(prefix = "") {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix));
  },

  clearTimer(key) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  },
};

export class TikTokService {
  constructor(io) {
    this.connections = new Map();
    this.io = io;
    this.aiServiceUrl = process.env.AI_SERVICE_URL || DEFAULT_AI_SERVICE_URL;
  }

  getStatus() {
    return [...this.connections.entries()].map(([username, meta]) => ({
      username,
      roomId: meta.roomId,
      connectedAt: meta.connectedAt,
      lastChatAt: meta.lastChatAt || null,
      chatCount: meta.chatCount || 0,
    }));
  }

  async connect(tiktokUsername, roomId) {
    const username = String(tiktokUsername || "").replace("@", "").trim();
    const room = String(roomId || "").trim();
    if (!username || !room) return false;
    if (this.connections.has(username)) {
      const meta = this.connections.get(username);
      if (meta.roomId === room) return true;

      console.log(`[TikTok] Rebinding @${username} from room ${meta.roomId} to ${room}`);
      this.disconnect(username);
    }

    const connection = new TikTokLiveConnection(username);

    connection.on(WebcastEvent.CHAT, (data) => {
      this.#handleChat(room, username, data).catch((error) => {
        console.error(`[TikTok] Chat handler failed for @${username}:`, error);
      });
    });

    connection.on(WebcastEvent.STREAM_END, () => {
      this.connections.delete(username);
      this.io.to(`room:${room}`).emit("tiktok:disconnected", { tiktokUsername: username });
      console.log(`[TikTok] Stream ended for @${username}`);
    });

    try {
      const state = await connection.connect();
      this.connections.set(username, {
        connection,
        roomId: room,
        connectedAt: new Date().toISOString(),
        lastChatAt: null,
        chatCount: 0,
      });
      this.io.to(`room:${room}`).emit("tiktok:connected", { tiktokUsername: username });
      console.log(`[TikTok] Connected to @${username} in room ${room}`);
      if (state?.roomId) console.log(`[TikTok] TikTok room id: ${state.roomId}`);
      return true;
    } catch (error) {
      console.error(`[TikTok] Failed to connect to @${username}:`, error.message);
      this.io.to(`room:${room}`).emit("tiktok:error", {
        tiktokUsername: username,
        error: error.message,
      });
      this.connections.delete(username);
      return false;
    }
  }

  disconnect(tiktokUsername) {
    const username = String(tiktokUsername || "").replace("@", "").trim();
    const meta = this.connections.get(username);
    if (!meta) return false;

    meta.connection.disconnect();
    this.connections.delete(username);
    return true;
  }

  async processGuess(roomId, username, rawWord) {
    const word = normalizeWord(rawWord);
    const round = await this.#getActiveRound(roomId) || await this.#autoStartRound(roomId);
    if (!round) return { ok: false, reason: "no_active_round", word };
    if (!isAllowedGuess(word)) return { ok: false, reason: "invalid_word", word };

    if (!(await this.#canSubmitFirstGuess(roomId, round.id, username))) {
      return { ok: false, reason: "waiting_for_starter", word };
    }

    if (await this.#wasWordUsedInRound(round.id, word)) {
      return { ok: false, reason: "duplicate_word", word };
    }

    const similarity = await this.#getSimilarity(round.word, word);

    if (similarity == null) return { ok: false, reason: "ai_unavailable", word };

    const rank = word === round.word
      ? 0
      : Math.max(2, Math.round((1 - Math.min(similarity, 0.9998)) * 10000));
    const user = await prisma.user.upsert({
      where: { tiktokUsername: username },
      update: {},
      create: { tiktokUsername: username },
    });

    await prisma.message.create({
      data: { roundId: round.id, userId: user.id, text: word, score: rank },
    });

    const guessData = {
      username,
      word: rank <= 1 ? MASKED_SECRET_WORD : word,
      rank,
      similarity,
    };
    if (rank <= 1) {
      guessData.secretWord = word;
    }
    this.io.to(`room:${roomId}`).emit("guess", guessData);
    this.io.to(`overlay:${roomId}`).emit("guess", guessData);

    if (rank <= 1) {
      await this.handleWin(roomId, round, user, word);
    }

    return { ok: true, guess: guessData };
  }

  async handleWin(roomId, round, user, word) {
    const attempts = await prisma.message.count({
      where: { roundId: round.id, userId: user.id },
    });

    await prisma.$transaction([
      prisma.winner.upsert({
        where: { roundId: round.id },
        update: { userId: user.id, attempts },
        create: { roundId: round.id, userId: user.id, attempts },
      }),
      prisma.round.update({
        where: { id: round.id },
        data: { endedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { wins: { increment: 1 }, points: { increment: 10 }, streak: { increment: 1 } },
      }),
    ]);

    await memoryStore.set(`lastWinner:${roomId}`, user.tiktokUsername);
    await memoryStore.del(`round:${roomId}`);

    this.io.to(`room:${roomId}`).emit("win", { username: user.tiktokUsername, word, roundId: round.id });
    this.io.to(`overlay:${roomId}`).emit("win", { username: user.tiktokUsername, word });
  }

  async #handleChat(roomId, streamUsername, data) {
    const words = extractGuessWords(data.comment);
    const text = words.length ? words.join(" | ") : normalizeWord(data.comment);
    const username = getTikTokCommentUsername(data);
    const meta = this.connections.get(streamUsername);

    if (meta) {
      meta.lastChatAt = new Date().toISOString();
      meta.chatCount = (meta.chatCount || 0) + 1;
    }

    this.io.to(`room:${roomId}`).emit("tiktok:chat", {
      username,
      text,
      rawText: data.comment || "",
      valid: words.some((word) => isAllowedGuess(word)),
    });

    if (!words.length) {
      this.#emitIgnored(roomId, { username, word: "", reason: "invalid_word" });
      return;
    }

    for (const word of words) {
      if (!isAllowedGuess(word)) {
        this.#emitIgnored(roomId, { username, word, reason: "invalid_word" });
        continue;
      }

      const dupKey = `dup:${roomId}:${word}`;
      if (await memoryStore.get(dupKey)) {
        this.#emitIgnored(roomId, { username, word, reason: "duplicate" });
        continue;
      }
      await memoryStore.set(dupKey, "1", "EX", 30);

      const result = await this.processGuess(roomId, username, word);
      if (!result?.ok) {
        await memoryStore.del(dupKey);
        this.#emitIgnored(roomId, { username, word, reason: result?.reason || "not_processed" });
      }
    }
  }

  async #getActiveRound(roomId) {
    const roundJson = await memoryStore.get(`round:${roomId}`);
    if (!roundJson) return null;

    try {
      return JSON.parse(roundJson);
    } catch {
      await memoryStore.del(`round:${roomId}`);
      return null;
    }
  }

  async #autoStartRound(roomId) {
    const cleanRoomId = String(roomId || "").trim();
    if (!cleanRoomId) return null;

    const savedWord = normalizeWord(await memoryStore.get(`secret:${cleanRoomId}`));
    const secretWord = savedWord || getRandomRussianWords(1)[0];
    if (!secretWord) return null;

    const wordRecord = await prisma.word.upsert({
      where: { text: secretWord },
      update: {},
      create: { text: secretWord, category: "auto" },
    });

    const round = await prisma.round.create({
      data: { roomId: cleanRoomId, wordId: wordRecord.id, hint: await selectHintWord({ secret: secretWord }) || null },
    });

    await memoryStore.set(`round:${cleanRoomId}`, JSON.stringify({ id: round.id, word: secretWord }));
    await memoryStore.set(`secret:${cleanRoomId}`, secretWord);
    this.io.to(`room:${cleanRoomId}`).emit("round:started", { roundId: round.id, hint: round.hint || "" });
    this.io.to(`overlay:${cleanRoomId}`).emit("round:started", { roundId: round.id, hint: round.hint || "" });

    return { id: round.id, word: secretWord };
  }

  async #canSubmitFirstGuess(roomId, roundId, username) {
    const messageCount = await prisma.message.count({ where: { roundId } });
    if (messageCount > 0) return true;

    if (username === "web_user") return true;

    const lastWinner = await memoryStore.get(`lastWinner:${roomId}`);
    return Boolean(lastWinner && lastWinner === username);
  }

  async #wasWordUsedInRound(roundId, word) {
    const existing = await prisma.message.findFirst({
      where: { roundId, text: word },
      select: { id: true },
    });

    return Boolean(existing);
  }

  #emitIgnored(roomId, payload) {
    this.io.to(`room:${roomId}`).emit("tiktok:ignored", payload);
    if (payload.reason !== "anti_spam" && payload.reason !== "duplicate") {
      console.log(`[TikTok] Ignored "${payload.word}" from @${payload.username || "unknown"} in ${roomId}: ${payload.reason}`);
    }
  }

  async #getSimilarity(secret, word) {
    try {
      const { data } = await axios.post(
        `${this.aiServiceUrl}/similarity`,
        { word1: secret, word2: word },
        { timeout: AI_TIMEOUT_MS },
      );

      return typeof data.similarity === "number" ? data.similarity : null;
    } catch (error) {
      console.error("[AI] similarity request failed:", error.message);
      return null;
    }
  }
}
