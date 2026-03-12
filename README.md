# Tilly Live Ops

**A real-time voice agent for hospitality operations, powered by Gemini Live API.**

Tilly Live Ops is a competition entry for the [Gemini Live Agent Challenge](https://devpost.com/). An operator talks to Tilly through a live voice interface — she can see across drivers, inventory, kitchen, marketing, staffing, and logistics, take corrective actions, and update the command surface in real time.

## Demo Story

A single continuous conversation during a live shift:

1. The operator opens the dashboard and clicks the orb to start talking
2. "Hey Tilly, how are the drivers doing?" → Tilly checks driver status, surfaces the delay on Driver 2, updates the Drivers panel
3. "What about the kitchen?" → Tilly checks prep status, flags low dough, updates Kitchen and Inventory panels
4. "Send a push notification for the loaded fries promo" → Tilly confirms details, sends the notification, updates Marketing panel and action timeline

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice | Gemini Live API (`gemini-2.5-flash-native-audio-preview-12-2025`) |
| Planning | Gemini 3 Flash (text) + transcript-driven keyword planner |
| Backend | Node.js + tsx + Hono |
| Frontend | React + Vite |
| Infra | Google Cloud Run (Terraform) |
| Design | CSS custom properties, dark/light theme, glassmorphism |

## Quick Start

```bash
pnpm install
cp .env.example .env   # Add your GOOGLE_API_KEY
pnpm dev
```

- **Web UI:** http://localhost:5173
- **API Server:** http://localhost:8787

## Architecture

```
apps/
  server/src/
    index.ts          — HTTP server, SSE events, turn_complete → planner
    liveSession.ts    — Gemini Live API session, audio streaming
    gemini.ts         — GenAI SDK client
    scenario.ts       — State, panels, tools, keyword planner
  web/src/
    App.tsx           — Single-component UI
    styles.css        — Design system with dark/light tokens
docs/                 — Competition submission docs
infra/                — Cloud Run Terraform
```

### How Voice → Actions Works

1. **User speaks** → browser captures audio → server streams to Gemini Live API
2. **Tilly responds** via audio — played back in the browser
3. On **turn complete**, the accumulated transcript is keyword-matched by the planner
4. Matching tools fire → panels and action timeline update in real-time via SSE

## Features

- 🎙️ **Real-time voice** — talk naturally, interrupt, ask follow-ups
- 📊 **Live command surface** — 6 operational domain panels update in real-time
- ⏱️ **Action timeline** — every action Tilly takes is logged with status
- 🌙 **Dark/light theme** — toggle in the top bar, persists across sessions
- 🔄 **Session resilience** — reconnection cooldown prevents cascading failures

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Gemini API key |
| `GEMINI_LIVE_MODEL` | Yes | `gemini-2.5-flash-native-audio-preview-12-2025` |
| `GEMINI_MODEL` | No | Text model for planning (default: `gemini-3-flash-preview`) |
| `GEMINI_LIVE_VOICE` | No | Voice name (default: `Aoede`) |

## Deployment

Cloud Run deployment via Terraform in `infra/`. See `docs/` for competition submission guidelines.

## License

Built for the Gemini Live Agent Challenge. Inspired by TillTech's real-world hospitality operations platform.
