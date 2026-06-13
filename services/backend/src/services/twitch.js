import tmi from "tmi.js";
import { extractGuessWords, isAllowedGuess, normalizeWord } from "../lib/words.js";

function cleanChannel(value) {
  return String(value || "")
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/^#/, "")
    .replace("@", "")
    .split(/[/?#\s]/)[0]
    .trim()
    .toLowerCase();
}

function getDisplayName(tags = {}) {
  return String(tags["display-name"] || tags.username || tags["user-id"] || "twitch_user").trim();
}

export class TwitchService {
  constructor(io, gameService) {
    this.connections = new Map();
    this.io = io;
    this.gameService = gameService;
  }

  getStatus() {
    return [...this.connections.entries()].map(([channel, meta]) => ({
      channel,
      roomId: meta.roomId,
      connectedAt: meta.connectedAt,
      lastChatAt: meta.lastChatAt || null,
      chatCount: meta.chatCount || 0,
    }));
  }

  async connect(channelInput, roomId) {
    const channel = cleanChannel(channelInput);
    const room = String(roomId || "").trim();
    if (!channel || !room) return false;

    if (this.connections.has(channel)) {
      const meta = this.connections.get(channel);
      if (meta.roomId === room) return true;
      await this.disconnect(channel);
    }

    const client = new tmi.Client({
      connection: { reconnect: true, secure: true },
      channels: [channel],
    });

    client.on("message", (joinedChannel, tags, message, self) => {
      if (self) return;
      this.#handleMessage(room, channel, tags, message).catch((error) => {
        console.error(`[Twitch] Chat handler failed for #${channel}:`, error);
      });
    });

    try {
      await client.connect();
      this.connections.set(channel, {
        client,
        roomId: room,
        connectedAt: new Date().toISOString(),
        lastChatAt: null,
        chatCount: 0,
      });
      this.io.to(`room:${room}`).emit("twitch:connected", { channel });
      console.log(`[Twitch] Connected to #${channel} in room ${room}`);
      return true;
    } catch (error) {
      console.error(`[Twitch] Failed to connect to #${channel}:`, error.message);
      this.io.to(`room:${room}`).emit("twitch:error", { channel, error: error.message });
      this.connections.delete(channel);
      return false;
    }
  }

  async disconnect(channelInput) {
    const channel = cleanChannel(channelInput);
    const meta = this.connections.get(channel);
    if (!meta) return false;

    try {
      await meta.client.disconnect();
    } catch {
      // tmi can throw when the socket is already closed.
    }
    this.connections.delete(channel);
    this.io.to(`room:${meta.roomId}`).emit("twitch:disconnected", { channel });
    return true;
  }

  async #handleMessage(roomId, channel, tags, rawText) {
    const words = extractGuessWords(rawText);
    const displayText = words.length ? words.join(" | ") : normalizeWord(rawText);
    const username = `twitch:${getDisplayName(tags)}`;
    const meta = this.connections.get(channel);

    if (meta) {
      meta.lastChatAt = new Date().toISOString();
      meta.chatCount = (meta.chatCount || 0) + 1;
    }

    this.io.to(`room:${roomId}`).emit("twitch:chat", {
      username,
      text: displayText,
      rawText,
      valid: words.some((word) => isAllowedGuess(word)),
    });

    if (!words.length) {
      this.io.to(`room:${roomId}`).emit("twitch:ignored", { username, word: "", reason: "invalid_word" });
      return;
    }

    for (const word of words) {
      if (!isAllowedGuess(word)) {
        this.io.to(`room:${roomId}`).emit("twitch:ignored", { username, word, reason: "invalid_word" });
        continue;
      }

      const result = await this.gameService.processGuess(roomId, username, word);
      if (!result?.ok) {
        this.io.to(`room:${roomId}`).emit("twitch:ignored", {
          username,
          word,
          reason: result?.reason || "not_processed",
        });
      }
    }
  }
}
