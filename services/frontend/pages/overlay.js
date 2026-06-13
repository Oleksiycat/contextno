import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { API_URL } from "../lib/config";
import { getHexColor, getWidth, upsertGuess } from "../lib/game";

export default function Overlay() {
  const [guesses, setGuesses] = useState([]);
  const [winner, setWinner] = useState(null);
  const [hint, setHint] = useState("");
  const roomId = useMemo(() => {
    if (typeof window === "undefined") return "room1";
    return new URLSearchParams(window.location.search).get("roomId") || "room1";
  }, []);

  useEffect(() => {
    const socket = io(API_URL);

    socket.on("connect", () => {
      socket.emit("join:overlay", { roomId });
    });

    socket.on("guess", (data) => {
      setGuesses((prev) => upsertGuess(prev, data, 8));
    });
    socket.on("win", ({ username, word }) => setWinner({ username, word }));
    socket.on("round:started", ({ hint: nextHint }) => {
      setGuesses([]);
      setWinner(null);
      setHint(nextHint || "");
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  return (
    <div style={{ background:"transparent", padding:10, width:340, fontFamily:"sans-serif" }}>
      {hint && (
        <div style={{ marginBottom:8, background:"rgba(39,51,64,.85)", borderRadius:8,
                      padding:"6px 12px", fontSize:13, color:"#9fb3c8", backdropFilter:"blur(4px)" }}>
          Категория: <b style={{ color:"#fff" }}>{hint}</b>
        </div>
      )}

      {winner ? (
        <div style={{ background:"rgba(0,186,124,.9)", borderRadius:10, padding:"12px 16px",
                      fontSize:18, fontWeight:700, textAlign:"center", color:"#fff",
                      animation:"flash 0.5s ease" }}>
          🎉 {winner.username} угадал(а)!{winner.word ? ` ${winner.word}` : ""}
        </div>
      ) : (
        <div style={{ display:"grid", gap:4 }}>
          {guesses.map((guess) => (
            <div key={guess.word} style={{
              position:"relative", display:"flex", justifyContent:"space-between",
              alignItems:"center", padding:"4px 10px", height:34, borderRadius:6,
              fontSize:16, fontWeight:700, background:"rgba(30,39,50,.9)",
              backdropFilter:"blur(4px)"
            }}>
              <div style={{
                position:"absolute", height:"100%", left:0, borderRadius:5,
                background: getHexColor(guess.rank), width:`${getWidth(guess.rank)}%`,
                opacity: 0.85
              }} />
              <span style={{ position:"relative", zIndex:2 }}>{guess.word}</span>
              <span style={{ position:"relative", zIndex:2, fontSize:14, color:"rgba(255,255,255,.8)" }}>
                {guess.rank}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes flash { 0%{opacity:0;transform:scale(.9)} 100%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}

