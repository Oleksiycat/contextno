# 🎮 Контекстно — TikTok Live

Игра слов для TikTok Live. Зрители угадывают загаданное слово прямо в чате.

## Быстрый старт

```bash
python3 con.py        # создаёт проект
cd kontekstno
cp .env.example .env  # при необходимости отредактируй
make dev              # запускает всё через Docker
```

## Доступ

| Сервис | URL |
|--------|-----|
| Игра (фронтенд) | http://localhost:3000 |
| Dashboard | http://localhost:3000/dashboard |
| OBS Overlay | http://localhost:3000/overlay?roomId=room1 |
| API | http://localhost:3001/api |
| AI-сервис | http://localhost:8001 |

## Настройки в игре

Нажми ⚙️ в левом верхнем углу → введи TikTok username стримера.
Система начнёт парсить чат этого стримера автоматически.

## Стек

- **Frontend**: Next.js 14, TypeScript, Tailwind, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO, Prisma, tiktok-live-connector
- **AI**: Python, FastAPI, SentenceTransformers (paraphrase-multilingual-MiniLM-L12-v2)
- **Infra**: Docker, PostgreSQL, Redis, Nginx
