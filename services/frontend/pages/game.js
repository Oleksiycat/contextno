import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { io } from "socket.io-client";
import axios from "axios";
import { API_URL } from "../lib/config";
import { getColor, getWidth, normalizeWord, upsertGuess, validateWordInput } from "../lib/game";
import { readJson, writeJson } from "../lib/storage";

const SETTINGS_KEY = "kontekstno_settings";
const SECRET_KEY = "kontekstno_last_secret";
const DEFAULT_SETTINGS = { tiktokUsername: "", twitchUsername: "leee1n", roomId: "room" };

export default function GamePage() {
  const [guesses, setGuesses] = useState([]);
  const [lastGuess, setLastGuess] = useState(null);
  const [twitchMessages, setTwitchMessages] = useState([]);
  const [tiktokMessages, setTiktokMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [winner, setWinner] = useState(null);
  const [hint, setHint] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [lastTikTokChat, setLastTikTokChat] = useState(null);
  const [lastTikTokIgnored, setLastTikTokIgnored] = useState(null);
  const [lastTwitchChat, setLastTwitchChat] = useState(null);
  const [lastTwitchIgnored, setLastTwitchIgnored] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsInput, setSettingsInput] = useState(DEFAULT_SETTINGS);
  const [adminWord, setAdminWord] = useState("");
  const [adminHint, setAdminHint] = useState("");
  const [loadingGuess, setLoadingGuess] = useState(false);
  const [lastError, setLastError] = useState("");
  const socketRef = useRef(null);

  const pushChatMessage = (setter, message) => {
    setter((prev) => [message, ...prev].slice(0, 12));
  };

  const getChatMessageWidth = (text) => {
    const length = String(text || "").trim().length;
    const width = Math.min(92, Math.max(58, 36 + Math.min(length * 2.15, 40)));
    return `${width}%`;
  };

  const loadRoundState = async (roomId) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/game/state`, { params: { roomId } });
      if (!data.round) return;

      setGuesses(data.guesses || []);
      setAttempts((data.guesses || []).length);
      setLastGuess((data.guesses || []).at(-1) || null);
      setWinner(null);
      setHint(data.round.hint || "");
      setTiktokMessages([]);
      setTwitchMessages([]);
      setLastTikTokIgnored(null);
      setLastTwitchIgnored(null);
      setLastError("");
    } catch {
      // Live socket updates still work if initial sync is unavailable.
    }
  };

  useEffect(() => {
    const savedSettings = readJson(SETTINGS_KEY, DEFAULT_SETTINGS);
    const savedSecret = typeof window !== "undefined" ? window.localStorage.getItem(SECRET_KEY) || "" : "";
    setSettings(savedSettings);
    setSettingsInput(savedSettings);
    setAdminWord(savedSecret);

    const socket = io(API_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      const roomId = savedSettings.roomId || "room";
      socket.emit("join:room", { roomId });
      loadRoundState(roomId);

      if (savedSettings.tiktokUsername) {
        socket.emit("connect:tiktok", {
          tiktokUsername: savedSettings.tiktokUsername,
          roomId,
        });
      }
      if (savedSettings.twitchUsername) {
        socket.emit("connect:twitch", {
          channel: savedSettings.twitchUsername,
          roomId,
        });
      }
    });

    socket.on("tiktok:error", (data) => {
      setLastError(`TikTok connection error (@${data.tiktokUsername}): ${data.error}`);
    });
    socket.on("tiktok:chat", (data) => {
      setLastTikTokChat(data);
      pushChatMessage(setTiktokMessages, {
        platform: "TikTok",
        username: data.username || "user",
        text: data.text || data.rawText || "",
      });
    });
    socket.on("tiktok:ignored", setLastTikTokIgnored);
    socket.on("twitch:error", (data) => {
      setLastError(`Twitch connection error (#${data.channel}): ${data.error}`);
    });
    socket.on("twitch:chat", (data) => {
      setLastTwitchChat(data);
      pushChatMessage(setTwitchMessages, {
        platform: "Twitch",
        username: data.username || "user",
        text: data.text || data.rawText || "",
      });
    });
    socket.on("twitch:ignored", setLastTwitchIgnored);

    socket.on("guess", (data) => {
      setLastGuess(data);
      setGuesses((prev) => upsertGuess(prev, data));
      setAttempts((value) => value + 1);
      setLoadingGuess(false);
      setLastError("");
    });

    socket.on("win", ({ username, word }) => {
      setWinner({ username, word });
    });
    socket.on("round:started", (data) => {
      setGuesses([]);
      setLastGuess(null);
      setTiktokMessages([]);
      setTwitchMessages([]);
      setAttempts(0);
      setWinner(null);
      setHint(data?.hint || "");
      setLastTikTokIgnored(null);
      setLastTwitchIgnored(null);
      setLastError("");
    });
    socket.on("game:reset", () => {
      setGuesses([]);
      setLastGuess(null);
      setTiktokMessages([]);
      setTwitchMessages([]);
      setAttempts(0);
      setWinner(null);
      setHint("");
      setLastTikTokIgnored(null);
      setLastTwitchIgnored(null);
      setLastError("");
    });

    return () => socket.disconnect();
  }, []);

  const saveSettings = () => {
    const nextSettings = {
      tiktokUsername: settingsInput.tiktokUsername.replace("@", "").trim(),
      twitchUsername: settingsInput.twitchUsername
        .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
        .replace("#", "")
        .trim(),
      roomId: settingsInput.roomId.trim() || "room",
    };

    writeJson(SETTINGS_KEY, nextSettings);
    setSettings(nextSettings);
    setSettingsInput(nextSettings);
    loadRoundState(nextSettings.roomId);

    if (socketRef.current) {
      socketRef.current.emit("join:room", { roomId: nextSettings.roomId });
      if (nextSettings.tiktokUsername) {
        socketRef.current.emit("connect:tiktok", {
          tiktokUsername: nextSettings.tiktokUsername,
          roomId: nextSettings.roomId,
        }, (result) => {
          if (!result?.ok) {
            setLastError(result?.error || "TikTok не подключился. Проверь username и что LIVE сейчас идёт.");
          }
        });
      }
      if (nextSettings.twitchUsername) {
        socketRef.current.emit("connect:twitch", {
          channel: nextSettings.twitchUsername,
          roomId: nextSettings.roomId,
        }, (result) => {
          if (!result?.ok) {
            setLastError(result?.error || "Twitch не подключился. Проверь канал.");
          }
        });
      }
    }

    setShowSettings(false);
  };

  const submitWord = async () => {
    const validation = validateWordInput(input);
    if (!validation.ok) {
      setLastError(validation.error);
      return;
    }

    if (guesses.some((guess) => guess.word === validation.word || guess.secretWord === validation.word)) {
      setLastError(`Слово ${validation.word} уже было введено`);
      return;
    }

    try {
      const { data } = await axios.get(`${API_URL}/api/words/dictionary/check/${encodeURIComponent(validation.word)}`);
      if (!data.known) {
        setLastError("Такого слова нет в словаре.");
        return;
      }
    } catch {
      // Backend performs the same validation.
    }

    setInput("");
    setLoadingGuess(true);
    setLastError("");

    try {
      const { data } = await axios.post(`${API_URL}/api/game/guess`, {
        word: validation.word,
        roomId: settings.roomId,
      });

      setGuesses((prev) => upsertGuess(prev, data));
      setLastGuess(data);
      setAttempts((value) => value + 1);
      if (data.rank <= 1) setWinner({ username: data.username || "Ты", word: data.secretWord || validation.word });
    } catch (error) {
      setInput(validation.word);
      setLastError(error.response?.data?.error || "Ошибка при отправке слова.");
    } finally {
      setLoadingGuess(false);
    }
  };

  const startRound = () => {
    if (!socketRef.current) return;

    const word = normalizeWord(adminWord);
    if (word && typeof window !== "undefined") {
      window.localStorage.setItem(SECRET_KEY, word);
    }

    socketRef.current.emit("start:round", {
      roomId: settings.roomId,
      word,
      hint: adminHint.trim(),
    }, (result) => {
      if (!result?.ok) {
        setLastError(result?.error || "Не удалось начать раунд.");
        return;
      }

      setAdminHint("");
      setShowSettings(false);
    });
  };

  const requestHint = async () => {
    try {
      setLoadingGuess(true);
      setLastError("");
      const { data } = await axios.post(`${API_URL}/api/game/hint`, {
        roomId: settings.roomId,
      });

      setGuesses((prev) => upsertGuess(prev, data));
      setLastGuess(data);
      setAttempts((value) => value + 1);
      if (data.rank <= 1) setWinner({ username: data.username || "hint_bot", word: data.secretWord || data.word });
    } catch (error) {
      setLastError(error.response?.data?.error || "Не удалось получить подсказку.");
    } finally {
      setLoadingGuess(false);
    }
  };

  const resetGame = () => {
    if (!socketRef.current) return;

    socketRef.current.emit("reset:game", { roomId: settings.roomId }, (result) => {
      if (!result?.ok) {
        setLastError(result?.error || "Не удалось сбросить игру.");
        return;
      }

      setGuesses([]);
      setLastGuess(null);
      setTiktokMessages([]);
      setTwitchMessages([]);
      setAttempts(0);
      setWinner(null);
      setHint("");
      setLastTikTokIgnored(null);
      setLastTwitchIgnored(null);
      setShowSettings(false);
    });
  };

  return (
    <>
      <Head><title>Контекстно</title></Head>
      <main className="game-root">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        {showSettings && (
          <div className="settings-overlay" onClick={() => setShowSettings(false)}>
            <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
              <h2 style={{ marginBottom:16, fontSize:18, fontWeight:600 }}>Настройки</h2>
              <label className="settings-label">TikTok username</label>
              <input
                className="input-kontekst"
                placeholder="@username"
                value={settingsInput.tiktokUsername}
                onChange={(event) => setSettingsInput((value) => ({ ...value, tiktokUsername: event.target.value.replace("@", "") }))}
                style={{ marginBottom:12 }}
              />
              <label className="settings-label">Twitch channel</label>
              <input
                className="input-kontekst"
                placeholder="leee1n"
                value={settingsInput.twitchUsername}
                onChange={(event) => setSettingsInput((value) => ({ ...value, twitchUsername: event.target.value }))}
                style={{ marginBottom:12 }}
              />
              <label className="settings-label">Комната</label>
              <input
                className="input-kontekst"
                placeholder="room"
                value={settingsInput.roomId}
                onChange={(event) => setSettingsInput((value) => ({ ...value, roomId: event.target.value }))}
                style={{ marginBottom:16 }}
              />
              <button className="btn-green settings-action" onClick={saveSettings}>
                Сохранить и подключить
              </button>

              <h3 style={{ marginTop:24, marginBottom:8, fontSize:16, fontWeight:600 }}>Управление игрой</h3>
              <input
                className="input-kontekst secret-input"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                name="secret-word"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="Секретное слово (можно оставить пустым)"
                value={adminWord}
                onChange={(event) => setAdminWord(event.target.value)}
                style={{ marginBottom:12 }}
              />
              <input
                className="input-kontekst"
                placeholder="Подсказка (категория)"
                value={adminHint}
                onChange={(event) => setAdminHint(event.target.value)}
                style={{ marginBottom:16 }}
              />
              <button className="round-button" onClick={startRound}>Начать раунд</button>
              <button className="reset-button" onClick={resetGame}>Сбросить игру</button>
            </div>
          </div>
        )}

        <header className="game-header">
          <Link href="/dashboard" className="leaderboard-btn" aria-label="Лидерборд" title="Лидерборд">
            <span className="leaderboard-icon" aria-hidden="true">🏆</span>
          </Link>
          <Link href="/"><p className="game-title">КОНТЕКСТНО</p></Link>
          <button className="menu-btn" onClick={() => setShowSettings(true)} aria-label="more" title="Настройки">
            <svg viewBox="0 0 24 24" style={{ fill:"currentColor", width:24, height:24 }}>
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        </header>

        <div className="chat-row">
          <section className="chat-panel chat-panel-twitch">
            <div className="chat-panel-shell">
              <div className="chat-panel-head">
                <div>
                  <div className="chat-panel-title">Twitch</div>
                  <div className="chat-panel-subtitle">Живой поток сообщений</div>
                </div>
                <div className="chat-panel-pill">LIVE</div>
              </div>
              <div className="chat-panel-stream">
                {twitchMessages.length ? (
                  twitchMessages.map((message, index) => (
                    <div
                      key={`${message.username}-${index}-${message.text}`}
                      className="chat-message chat-message-twitch"
                      style={{
                        width: getChatMessageWidth(message.text),
                        alignSelf: "flex-start",
                      }}
                    >
                      <div className="chat-message-accent" />
                      <div className="chat-message-user">#{message.username}</div>
                      <div className="chat-message-text">{message.text}</div>
                    </div>
                  ))
                ) : (
                  <div className="chat-panel-empty">Сообщений пока нет</div>
                )}
              </div>
              {lastTwitchIgnored && (
                <div className="chat-panel-warning">
                  Не добавлено: "{lastTwitchIgnored.word}" ({lastTwitchIgnored.reason})
                </div>
              )}
            </div>
          </section>

          <section className="chat-panel chat-panel-tiktok">
            <div className="chat-panel-shell">
              <div className="chat-panel-head">
                <div>
                  <div className="chat-panel-title">TikTok</div>
                  <div className="chat-panel-subtitle">Живой поток сообщений</div>
                </div>
                <div className="chat-panel-pill chat-panel-pill-alt">LIVE</div>
              </div>
              <div className="chat-panel-stream">
                {tiktokMessages.length ? (
                  tiktokMessages.map((message, index) => (
                    <div
                      key={`${message.username}-${index}-${message.text}`}
                      className="chat-message chat-message-tiktok"
                      style={{
                        width: getChatMessageWidth(message.text),
                        alignSelf: "flex-start",
                      }}
                    >
                      <div className="chat-message-accent" />
                      <div className="chat-message-user">@{message.username}</div>
                      <div className="chat-message-text">{message.text}</div>
                    </div>
                  ))
                ) : (
                  <div className="chat-panel-empty">Сообщений пока нет</div>
                )}
              </div>
              {lastTikTokIgnored && (
                <div className="chat-panel-warning">
                  Не добавлено: "{lastTikTokIgnored.word}" ({lastTikTokIgnored.reason})
                </div>
              )}
            </div>
          </section>
        </div>

        <div style={{ marginBottom:10 }}>
          <div className="tip-container">
            <button className="tip-button" onClick={requestHint} title="Получить подсказку">
              <svg viewBox="0 0 24 24" style={{ fill:"white", width:24, height:24 }}>
                <path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7z"/>
              </svg>
            </button>
            <p className="tip-text">подсказка</p>
            {hint && <div className="hint-box">Категория: <b>{hint}</b></div>}
          </div>
        </div>

        <div className="game-info">
          <div className="info-item">Попыток: <span className="info-bold">{attempts}</span></div>
          {settings.tiktokUsername && <div className="info-item">Чат: <span className="info-bold">@{settings.tiktokUsername}</span></div>}
          {settings.twitchUsername && <div className="info-item">Twitch: <span className="info-bold">#{settings.twitchUsername}</span></div>}
        </div>

        <div className="game-input-row">
          <input
            className="input-kontekst play-input"
            placeholder="введите слово"
            autoCapitalize="off"
            autoComplete="off"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitWord()}
          />
          <button className="btn-green send-button" disabled={!input.trim()} onClick={submitWord}>
            <svg viewBox="0 0 24 24" style={{ fill:"white", width:24, height:24 }}>
              <path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
            </svg>
          </button>
        </div>

        {lastGuess && (() => {
          const color = getColor(lastGuess.rank);
          const width = getWidth(lastGuess.rank);
          return (
            <div className="last-word-list">
              <div className={`result-item result-rank-${color} new-item last-word-item`}>
                <div className={`result-fill fill-${color}`} style={{ width: `${width}%` }} />
                <span className="result-word">{lastGuess.secretWord || lastGuess.word}</span>
                <span className="result-score">{typeof lastGuess.rank === "number" ? lastGuess.rank : "—"}</span>
              </div>
            </div>
          );
        })()}

        {winner && (
          <div className="completed">
            <div className="win-spark">вњ¦</div>
            <div>{winner.username} угадал(а) слово</div>
            <strong className="win-word">{winner.word}</strong>
          </div>
        )}
        {winner && (
          <button className="restart-button" onClick={startRound} title="Новый раунд">
            <svg viewBox="0 0 24 24" style={{ fill:"none", stroke:"currentColor", strokeWidth:2.4, width:24, height:24, strokeLinecap:"round", strokeLinejoin:"round" }}>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        )}

        <div className="results-list">
          {lastError && <div className="error-row">{lastError}</div>}
          {loadingGuess && (
            <div className="loading-row">
              <div className="loading-shimmer" />
              <div className="loading-content">
                <div className="loading-placeholder loading-text" />
                <div className="loading-placeholder loading-score" />
              </div>
            </div>
          )}
          {guesses.map((guess, index) => {
            const color = getColor(guess.rank);
            const width = getWidth(guess.rank);
            return (
              <div
                key={`${guess.word}-${guess.username || index}`}
                className={`result-item result-rank-${color}${guess.isNew ? " new-item" : ""}`}
                style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}
              >
                <div className={`result-fill fill-${color}`} style={{ width: `${width}%` }} />
                <span className="result-word">{guess.word}</span>
                <span className="result-score">{guess.rank}</span>
              </div>
            );
          })}
        </div>

        <style jsx>{`
          .game-root {
            display: flex; flex-direction: column; align-items: center;
            justify-content: flex-start; min-height: 100vh; width: 100vw;
            padding: 15px 15px 100px; background-color: #15202b; color: #fff; position: relative;
            overflow-x: hidden;
          }
          .ambient {
            position: fixed;
            pointer-events: none;
            opacity: .13;
            filter: blur(1px);
            z-index: 0;
          }
          .ambient-one {
            inset: 0 auto auto 0;
            width: 220px;
            height: 220px;
            background: radial-gradient(circle, #00ba7c 0 1px, transparent 2px);
            background-size: 22px 22px;
            animation: drift 18s linear infinite;
          }
          .ambient-two {
            right: 0;
            bottom: 0;
            width: 260px;
            height: 260px;
            background: radial-gradient(circle, #ef7d31 0 1px, transparent 2px);
            background-size: 26px 26px;
            animation: driftReverse 22s linear infinite;
          }
          .game-header, .tip-container, .game-info, .game-input-row, .completed, .restart-button, .results-list, .chat-row {
            position: relative;
            z-index: 1;
          }
          .game-header {
            width: 480px; display: flex; flex-direction: row;
            align-items: center; justify-content: center; margin-bottom: 10px;
            animation: dropIn .45s ease both;
          }
          .game-title {
            font-weight: 600; font-size: 24px; line-height: 0;
            animation: titleGlow 3.8s ease-in-out infinite;
          }
          .leaderboard-btn {
            position: absolute; left: 0; width: 40px; height: 40px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 12px; background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.12);
            box-shadow: 0 2px 8px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
            backdrop-filter: blur(6px);
            transition: transform .15s ease, background .2s ease, box-shadow .2s ease;
          }
          .leaderboard-btn:hover {
            transform: translateY(-1px) scale(1.08) rotate(-4deg);
            background: rgba(255,255,255,.1);
            box-shadow: 0 6px 14px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.06);
          }
          .leaderboard-btn:active { transform: translateY(0) scale(.98); }
          .leaderboard-icon { font-size: 20px; line-height: 1; filter: drop-shadow(0 1px 0 rgba(0,0,0,.4)); }
          .menu-btn {
            position: absolute; right: 0; width: 40px; height: 40px;
            display: flex; align-items: center; justify-content: center;
            border: 0; border-radius: 50%; color: #fff; background: transparent;
            cursor: pointer; transition: background-color .15s ease, transform .15s ease;
          }
          .menu-btn:hover { background-color: rgba(255,255,255,.08); transform: rotate(90deg); }
          .tip-container { display: flex; flex-direction: column; align-items: center; animation: popIn .45s ease .08s both; }
          .tip-button {
            display: flex; justify-content: center; align-items: center;
            padding: 10px; border-radius: 5px; background-color: #ef7d31;
            height: 48px; width: 48px; cursor: pointer; border: 0;
            box-shadow: 0 0 0 rgba(239,125,49,0);
            animation: hintPulse 2.6s ease-in-out infinite;
            transition: transform .18s ease, background-color .18s ease;
          }
          .tip-button:hover { background-color: #c36628; transform: translateY(-2px) scale(1.06); }
          .tip-text { font-size: 10px; margin-top: 2px; }
          .hint-box {
            margin-top: 8px; padding: 8px 12px; background: rgba(239,125,49,.2);
            border: 1px solid #ef7d31; border-radius: 6px; color: #fff; font-size: 14px;
            animation: slideUp .22s ease both;
          }
          .game-info { display: flex; justify-content: flex-start; width: 480px; margin-bottom: 10px; animation: fadeIn .45s ease .12s both; }
          .info-item { font-size: 16px; margin-right: 20px; }
          .info-bold {
            font-weight: 600; font-size: 20px; max-width: 140px;
            overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .game-input-row { display: flex; flex-direction: row; gap: 5px; width: 480px; margin-bottom: 10px; animation: slideUp .42s ease .16s both; }
          .play-input:focus, .secret-input:focus {
            box-shadow: 0 0 0 3px rgba(0,186,124,.16), 0 10px 28px rgba(0,0,0,.18);
            transform: translateY(-1px);
          }
          .last-word-list {
            width: 480px;
            margin: -2px 0 12px;
            display: grid;
            gap: 5px;
            animation: fadeIn .25s ease both;
          }
          .last-word-item { animation-delay: 0s; }
          .send-button {
            width: 40px; height: 48px; border-radius: 4px; display: flex;
            align-items: center; justify-content: center; flex-shrink: 0;
            transition: transform .16s ease, box-shadow .16s ease, background-color .16s ease;
          }
          .send-button:hover:not(:disabled) { transform: translateX(2px) scale(1.04); box-shadow: 0 8px 18px rgba(0,186,124,.25); }
          .results-list { margin-top: 20px; display: grid; gap: 5px; width: 480px; margin-bottom: 40px; }
          .result-word, .result-score { position: relative; z-index: 3; }
          .result-score { color: rgba(255,255,255,.9); font-size: 16px; }
          .completed {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; font-size: 22px; font-weight: 600; line-height: 1.1; text-align: center;
            margin: 10px 0 20px; padding: 20px; border-radius: 10px;
            background-color: #273340; width: 480px;
            box-shadow: 0 0 0 2px rgba(0,186,124,.5), 0 18px 44px rgba(0,0,0,.28);
            animation: winPop .55s cubic-bezier(.2,1.4,.35,1) both;
          }
          .win-spark { color: #ef7d31; animation: spinSpark 1.8s linear infinite; }
          .win-word { color: #00ba7c; font-size: 28px; text-shadow: 0 0 18px rgba(0,186,124,.25); }
          .restart-button {
            width: 48px; height: 48px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35);
            background: #00ba7c; color: #fff; cursor: pointer; display: flex;
            align-items: center; justify-content: center; margin-top: 10px;
            transition: transform .18s ease, box-shadow .18s ease;
            animation: popIn .35s ease both;
          }
          .restart-button:hover { transform: rotate(120deg) scale(1.08); box-shadow: 0 10px 24px rgba(0,186,124,.28); }
          .chat-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            width: 480px;
            margin-bottom: 16px;
            animation: fadeIn .25s ease both;
          }
          .chat-panel {
            position: relative;
            min-height: 320px;
            padding: 14px;
            border-radius: 18px;
            border: 1px solid rgba(255,255,255,.12);
            overflow: hidden;
            box-shadow: 0 18px 42px rgba(0,0,0,.22);
            backdrop-filter: blur(12px);
            isolation: isolate;
          }
          .chat-panel-twitch {
            border-color: rgba(145, 90, 255, .38);
            background:
              radial-gradient(circle at 18% 12%, rgba(145,90,255,.32), transparent 34%),
              radial-gradient(circle at 82% 28%, rgba(255,255,255,.10), transparent 28%),
              linear-gradient(135deg, rgba(54,25,98,.82), rgba(20,16,34,.9));
            animation: panelShift 12s ease-in-out infinite alternate;
          }
          .chat-panel-tiktok {
            border-color: rgba(0, 186, 124, .38);
            background:
              radial-gradient(circle at 82% 12%, rgba(0,186,124,.32), transparent 34%),
              radial-gradient(circle at 20% 30%, rgba(255,255,255,.08), transparent 26%),
              linear-gradient(135deg, rgba(0,77,58,.82), rgba(13,22,24,.9));
            animation: panelShift 14s ease-in-out infinite alternate-reverse;
          }
          .chat-panel::before {
            content: "";
            position: absolute;
            inset: -30%;
            background:
              linear-gradient(115deg, transparent 35%, rgba(255,255,255,.08) 50%, transparent 65%);
            transform: translateX(-18%);
            animation: sheen 6.5s linear infinite;
            pointer-events: none;
            z-index: 0;
          }
          .chat-panel::after {
            content: "";
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at center, rgba(255,255,255,.05), transparent 55%);
            pointer-events: none;
            z-index: 0;
          }
          .chat-panel-shell {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            gap: 10px;
            height: 100%;
          }
          .chat-panel-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
          }
          .chat-panel-subtitle {
            margin-top: 2px;
            font-size: 11px;
            color: rgba(255,255,255,.65);
            letter-spacing: .03em;
          }
          .chat-panel-pill {
            min-width: 46px;
            height: 24px;
            padding: 0 10px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .12em;
            background: rgba(255,255,255,.14);
            color: #fff;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
          }
          .chat-panel-pill-alt {
            background: rgba(0,186,124,.18);
          }
          .chat-panel-stream {
            flex: 1;
            overflow: auto;
            display: flex;
            flex-direction: column-reverse;
            align-items: flex-start;
            gap: 8px;
            padding-right: 4px;
            scroll-behavior: smooth;
          }
          .chat-panel-title {
            font-size: 14px;
            font-weight: 800;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: #fff;
            line-height: 1;
          }
          .chat-message {
            position: relative;
            padding: 10px 12px 10px 15px;
            border-radius: 16px 18px 18px 16px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,.1);
            box-shadow: 0 10px 22px rgba(0,0,0,.18);
            transform-origin: left center;
            animation: messageIn .28s ease both;
          }
          .chat-message-twitch {
            background: linear-gradient(135deg, rgba(132,87,228,.22), rgba(58,28,106,.72));
          }
          .chat-message-tiktok {
            background: linear-gradient(135deg, rgba(0,186,124,.18), rgba(10,72,54,.72));
          }
          .chat-message-accent {
            position: absolute;
            inset: 0 auto 0 0;
            width: 4px;
            border-radius: 16px 0 0 16px;
            background: rgba(255,255,255,.2);
            z-index: 1;
          }
          .chat-message-twitch .chat-message-accent {
            background: linear-gradient(180deg, #a970ff, #6441a5);
          }
          .chat-message-tiktok .chat-message-accent {
            background: linear-gradient(180deg, #25f4ee, #fe2c55);
          }
          .chat-message::before {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, rgba(255,255,255,.06), transparent 45%);
            pointer-events: none;
          }
          .chat-message-user {
            position: relative;
            z-index: 1;
            font-size: 11px;
            font-weight: 700;
            color: rgba(255,255,255,.72);
            margin-bottom: 4px;
            letter-spacing: .03em;
          }
          .chat-message-text {
            position: relative;
            z-index: 1;
            font-size: 13px;
            color: #fff;
            word-break: break-word;
            line-height: 1.32;
          }
          .chat-panel-empty {
            color: rgba(255,255,255,.72);
            font-size: 13px;
            min-height: 88px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 14px;
            border: 1px dashed rgba(255,255,255,.16);
            background: rgba(255,255,255,.04);
          }
          .chat-panel-warning {
            margin-top: auto;
            font-size: 12px;
            color: #ef7d31;
            line-height: 1.3;
          }
          .settings-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 100;
            display: flex; align-items: center; justify-content: center;
            animation: fadeIn .18s ease both;
          }
          .settings-panel {
            background: #273340; border: 2px solid #fff; border-radius: 10px;
            color: #fff; padding: 24px; width: 420px;
            animation: modalIn .22s ease both;
          }
          .settings-label { font-size: 13px; color: #9fb3c8; margin-bottom: 4px; display: block; }
          .settings-action { width: 100%; height: 44px; border-radius: 8px; font-size: 16px; font-weight: 600; }
          .round-button {
            width: 100%; height: 44px; border-radius: 8px; font-size: 16px; font-weight: 600;
            background: #ef7d31; color: #fff; border: none; cursor: pointer;
            transition: transform .16s ease, background-color .16s ease;
          }
          .round-button:hover { background: #c36628; transform: translateY(-1px); }
          .reset-button {
            width: 100%; height: 44px; border-radius: 8px; font-size: 16px; font-weight: 600;
            background: #273340; color: #fff; border: 1px solid #fff; cursor: pointer; margin-top: 10px;
            transition: transform .16s ease, background-color .16s ease;
          }
          .reset-button:hover { background: #1e2732; transform: translateY(-1px); }
          @keyframes dropIn { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes popIn { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
          @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
          @keyframes hintPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,125,49,.24); }
            50% { box-shadow: 0 0 0 8px rgba(239,125,49,0); }
          }
          @keyframes titleGlow {
            0%, 100% { text-shadow: 0 0 0 rgba(255,255,255,0); }
            50% { text-shadow: 0 0 18px rgba(255,255,255,.16); }
          }
          @keyframes winPop {
            0% { opacity: 0; transform: translateY(12px) scale(.92); }
            70% { transform: translateY(-2px) scale(1.03); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes spinSpark { to { transform: rotate(360deg); } }
          @keyframes drift { to { transform: translate3d(22px, 22px, 0); } }
          @keyframes driftReverse { to { transform: translate3d(-26px, -26px, 0); } }
          @keyframes panelShift {
            from { background-position: 0% 0%; }
            to { background-position: 100% 100%; }
          }
          @keyframes sheen {
            from { transform: translateX(-24%) rotate(0deg); }
            to { transform: translateX(24%) rotate(0deg); }
          }
          @keyframes messageIn {
            from { opacity: 0; transform: translateY(8px) scale(.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @media (max-width: 480px) {
            .game-header, .game-info, .game-input-row, .results-list, .completed, .chat-row, .last-word-list { width: 100%; }
            .chat-row { grid-template-columns: 1fr; }
            .chat-panel { min-height: 240px; }
            .settings-panel { width: calc(100% - 32px); }
            .ambient { display: none; }
          }
        `}</style>
      </main>
    </>
  );
}

