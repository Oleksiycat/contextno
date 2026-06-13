import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../lib/config";

const LEAGUE_COLOR = {
  Bronze: "#cd7f32",
  Silver: "#c0c0c0",
  Gold: "#ffd700",
  Diamond: "#b9f2ff",
};

export default function Dashboard() {
  const [stats, setStats] = useState({ users: 0, rounds: 0, messages: 0, winners: 0 });
  const [top, setTop] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const [statsResponse, leaderboardResponse] = await Promise.all([
          axios.get(`${API_URL}/api/stats/overview`),
          axios.get(`${API_URL}/api/game/leaderboard`),
        ]);

        if (!cancelled) {
          setStats(statsResponse.data);
          setTop(leaderboardResponse.data.slice(0, 10));
        }
      } catch {
        if (!cancelled) {
          setStats({ users: 0, rounds: 0, messages: 0, winners: 0 });
          setTop([]);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Head><title>Dashboard — Контекстно</title></Head>
      <div style={{ minHeight:"100vh", background:"#15202b", color:"#fff", padding:24 }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24 }}>
            <Link href="/" style={{ color:"#9fb3c8", textDecoration:"none", fontSize:14 }}>← Главная</Link>
            <h1 style={{ fontSize:24, fontWeight:700 }}>Dashboard</h1>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:24 }}>
            {[["👥 Игроки", stats.users], ["🎮 Раундов", stats.rounds],
              ["💬 Сообщений", stats.messages], ["🏆 Побед", stats.winners]].map(([label, value]) => (
              <div key={label} style={{ background:"#273340", borderRadius:10, padding:"16px 20px" }}>
                <p style={{ fontSize:13, color:"#9fb3c8", marginBottom:4 }}>{label}</p>
                <p style={{ fontSize:28, fontWeight:700 }}>{value}</p>
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <div style={{ background:"#273340", borderRadius:10, padding:20 }}>
              <h2 style={{ fontSize:16, fontWeight:600, marginBottom:12 }}>🏅 Топ игроки</h2>
              {top.map((user, index) => (
                <div key={user.tiktokUsername} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"6px 0", borderBottom:"1px solid #1e2732" }}>
                  <span style={{ color:"#9fb3c8", marginRight:8 }}>#{index + 1}</span>
                  <span style={{ flex:1 }}>@{user.tiktokUsername}</span>
                  <span style={{ color: LEAGUE_COLOR[user.league] || "#fff", fontSize:12, marginRight:8 }}>{user.league}</span>
                  <span style={{ fontWeight:700 }}>{user.points}</span>
                </div>
              ))}
              {top.length === 0 && <p style={{ color:"#9fb3c8", fontSize:14 }}>Нет данных</p>}
            </div>

            <div style={{ background:"#273340", borderRadius:10, padding:20 }}>
              <h2 style={{ fontSize:16, fontWeight:600, marginBottom:12 }}>🔗 Быстрые ссылки</h2>
              {[["🎮 Игра", "/game"],
                ["📊 Комнаты", "/dashboard/rooms"],
                ["📝 Слова", "/dashboard/words"],
                ["📺 OBS Overlay", "/overlay?roomId=room1"]].map(([label, href]) => (
                <Link key={href} href={href} style={{ display:"block", padding:"10px 0",
                  borderBottom:"1px solid #1e2732", color:"#fff", textDecoration:"none",
                  fontSize:15, transition:"color .15s" }}>
                  {label} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
