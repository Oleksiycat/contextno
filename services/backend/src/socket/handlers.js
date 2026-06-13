import { memoryStore } from "../services/tiktok.js";
import { prisma } from "../lib/prisma.js";
import { getRandomRussianWords, normalizeWord, isKnownRussianWord } from "../lib/words.js";
import { selectHintWord } from "../lib/hint.js";

function requireRoomId(payload) {
  const roomId = String(payload?.roomId || "").trim();
  return roomId || null;
}

export async function startRound(io, { roomId, word, hint = "" }) {
  const cleanRoomId = String(roomId || "").trim();
  const submittedWord = normalizeWord(word);
  const savedWord = cleanRoomId ? await memoryStore.get(`secret:${cleanRoomId}`) : null;
  const randomWord = getRandomRussianWords(1)[0];
  const cleanWord = submittedWord || normalizeWord(savedWord) || randomWord;
  const providedHint = String(hint || "").trim();
  const cleanHint = providedHint || await selectHintWord({ secret: cleanWord });
  const wordCategory = providedHint || "general";

  if (!cleanRoomId || !cleanWord || !isKnownRussianWord(cleanWord)) {
    return { ok: false, error: "Введите секретное слово из словаря хотя бы один раз." };
  }

  const wordRecord = await prisma.word.upsert({
    where: { text: cleanWord },
    update: { category: wordCategory },
    create: { text: cleanWord, category: wordCategory },
  });

  const round = await prisma.round.create({
    data: { roomId: cleanRoomId, wordId: wordRecord.id, hint: cleanHint || null },
  });

  await memoryStore.set(`round:${cleanRoomId}`, JSON.stringify({ id: round.id, word: cleanWord }));
  await memoryStore.set(`secret:${cleanRoomId}`, cleanWord);
  io.to(`room:${cleanRoomId}`).emit("round:started", { roundId: round.id, hint: cleanHint });
  io.to(`overlay:${cleanRoomId}`).emit("round:started", { roundId: round.id, hint: cleanHint });

  return { ok: true, roundId: round.id, reusedSecret: !submittedWord };
}

export function setupSocketHandlers(io, tiktokService, twitchService) {
  io.on("connection", (socket) => {
    socket.on("join:room", (payload = {}) => {
      const roomId = requireRoomId(payload);
      if (roomId) socket.join(`room:${roomId}`);
    });

    socket.on("join:overlay", (payload = {}) => {
      const roomId = requireRoomId(payload);
      if (roomId) socket.join(`overlay:${roomId}`);
    });

    socket.on("start:round", async (payload = {}, callback) => {
      try {
        const roomId = requireRoomId(payload);
        const result = await startRound(io, { roomId, word: payload.word, hint: payload.hint });
        callback?.(result);
      } catch (error) {
        console.error("[socket:start:round]", error);
        callback?.({ ok: false, error: "Не удалось начать раунд." });
      }
    });

    socket.on("reset:game", async (payload = {}, callback) => {
      try {
        const roomId = requireRoomId(payload);
        if (!roomId) {
          callback?.({ ok: false, error: "Missing room id" });
          return;
        }

        await memoryStore.del(`round:${roomId}`);
        io.to(`room:${roomId}`).emit("game:reset");
        io.to(`overlay:${roomId}`).emit("game:reset");
        callback?.({ ok: true });
      } catch (error) {
        console.error("[socket:reset:game]", error);
        callback?.({ ok: false, error: "Не удалось сбросить игру." });
      }
    });

    socket.on("connect:tiktok", async (payload = {}, callback) => {
      const roomId = requireRoomId(payload);
      const tiktokUsername = String(payload.tiktokUsername || "").replace("@", "").trim();

      if (!roomId || !tiktokUsername) {
        callback?.({ ok: false, error: "Missing TikTok username or room id" });
        return;
      }

      try {
        const connected = await tiktokService.connect(tiktokUsername, roomId);
        callback?.({ ok: connected });
      } catch (error) {
        console.error("[socket:connect:tiktok]", error);
        callback?.({ ok: false, error: "TikTok connection failed" });
      }
    });

    socket.on("disconnect:tiktok", (payload = {}) => {
      const tiktokUsername = String(payload.tiktokUsername || "").replace("@", "").trim();
      if (!tiktokUsername) return;
      tiktokService.disconnect(tiktokUsername);
    });

    socket.on("connect:twitch", async (payload = {}, callback) => {
      const roomId = requireRoomId(payload);
      const channel = String(payload.channel || payload.twitchUsername || "").trim();

      if (!roomId || !channel) {
        callback?.({ ok: false, error: "Missing Twitch channel or room id" });
        return;
      }

      try {
        const connected = await twitchService.connect(channel, roomId);
        callback?.({ ok: connected });
      } catch (error) {
        console.error("[socket:connect:twitch]", error);
        callback?.({ ok: false, error: "Twitch connection failed" });
      }
    });

    socket.on("disconnect:twitch", async (payload = {}) => {
      const channel = String(payload.channel || payload.twitchUsername || "").trim();
      if (!channel) return;
      await twitchService.disconnect(channel);
    });
  });
}
