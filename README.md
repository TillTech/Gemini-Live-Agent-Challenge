<div align="center">

# 🎙️ Tilly Live Ops

### Real-time voice agent for hospitality operations

*One live conversation replaces scattered operational checks, repeated dashboard hopping, and delayed response to issues.*

[![Built with Gemini](https://img.shields.io/badge/Built%20with-Gemini%20Live%20API-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![Competition](https://img.shields.io/badge/Gemini%20Live-Agent%20Challenge-FF6F00?style=for-the-badge&logo=devpost&logoColor=white)](https://devpost.com/)
[![Category](https://img.shields.io/badge/Category-Live%20Agents%20🗣️-8E24AA?style=for-the-badge)](https://devpost.com/)

</div>

<br/>

## What This Is

Tilly Live Ops is a new public project inspired by real hospitality operations patterns at [TillTech](https://till.tech). An operator talks to Tilly through a live voice interface — she can see across drivers, inventory, kitchen, marketing, staffing, and logistics, take corrective actions, and update the command surface in real time.

This is **not a chatbot**. The centre of the experience is a live operations canvas with status panels, action timelines, and animated visualisation cards that respond to natural voice conversation.

> Built for the [Gemini Live Agent Challenge](https://devpost.com/) — **Competition Category:** Live Agents 🗣️ (Real-time Interaction)

<br/>

## Demo Flow

A single continuous voice conversation during a live shift — taken from the actual [demo script](docs/demo-script.md):

| Turn | Operator Says | Tilly Does |
|------|---------------|------------|
| 1 | *"Give me a quick operational rundown. Have all the drivers clocked in?"* | Driver and staffing panels update. Surfaces Driver 2 delayed by traffic, one delivery ~15 min behind. |
| 2 | *"Send the customer an automated SMS and drop 50 loyalty points into their wallet. Check stock in the prep kitchen — how's fresh dough?"* | Action rail shows SMS sent + loyalty credit. Inventory and kitchen panels update. Fresh dough at 20 portions, below Friday threshold. |
| 3 | *"Halt garlic bread prep to save dough for pizzas. Spin up a quick loaded fries promo."* | Kitchen panel shows garlic bread blocked. Marketing opens draft state. Tilly asks what kind of promo. |
| 4 | *"20% off QR code, push it to everyone with our app."* | Campaign drafted, push notification sent. Marketing panel confirms. |

<br/>

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Voice | Gemini Live API | `gemini-2.5-flash-native-audio-preview-12-2025` |
| Text + Image | Nano Banana 2 (Gemini 3.1 Flash Image) | `gemini-3.1-flash-image-preview` |
| Backend | Node.js + tsx (plain `node:http`) | Node 22+ |
| Frontend | React + Vite | React ^19.1.0, Vite ^6.3.5 |
| AI SDK | @google/genai | ^1.11.0 |
| Infra | Google Cloud Run | Terraform |
| Design | CSS custom properties | Dark/light theme tokens |

<br/>

## Quick Start

```bash
pnpm install
cp .env.example .env   # Add your GOOGLE_API_KEY
pnpm dev
```

| Service | URL |
|---------|-----|
| Web UI | http://localhost:5173 |
| API Server | http://localhost:8787 |

### Environment Variables

All variables are documented in [`.env.example`](.env.example):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_API_KEY` | Yes | — | Gemini API key |
| `GEMINI_LIVE_MODEL` | Yes | — | `gemini-2.5-flash-native-audio-preview-12-2025` |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Text model for planning fallback |
| `GOOGLE_CLOUD_PROJECT` | No | — | GCP project ID (for Vertex AI or deployment) |
| `GOOGLE_CLOUD_REGION` | No | `europe-west2` | GCP region |
| `GOOGLE_GENAI_USE_VERTEXAI` | No | `false` | Use Vertex AI instead of API key auth |

<br/>

## Architecture

```
apps/
  server/src/
    index.ts          — HTTP server, SSE broadcast, 3-tier action detection
    liveSession.ts    — Gemini Live API session, audio streaming, transcripts
    gemini.ts         — GenAI SDK client, text-model planning path
    scenario.ts       — State engine, panel data, smart + keyword planners
    types.ts          — Snapshot, ActionItem, PlannedAction, PanelState
  web/src/
    App.tsx           — Single-component UI
    styles.css        — Design system with dark/light tokens
docs/                 — Demo script, brand story, submission drafts
infra/                — Cloud Run Terraform config
```

### How Voice → Actions Works

The Gemini Live audio model does not reliably call tools directly, so Tilly uses a 3-tier detection system:

1. **Tier 1 — function_call:** When Gemini does call a tool, it fires immediately. Tracked per turn to prevent duplicates.
2. **Tier 2 — Output-transcript matching:** Scans Tilly's spoken response for confirmation phrases and extracts dynamic data.
3. **Tier 3 — Input keyword fallback:** Matches the user's words. Info queries (drivers, stock, staff) fire immediately. Action queries (promotions, push notifications) wait for confirmation or specific detail.

All actions update the state via SSE — panels, action timeline, and centre-stage viz cards respond in real-time.

<br/>

## Features

- 🎙️ **Real-time voice** — natural conversation via Gemini Live API, with interrupt and follow-up support
- 📊 **Live command surface** — 6 operational panels (Drivers, Inventory, Kitchen, Marketing, Customers, Staff)
- 🎬 **Action visualisation** — animated centre-stage cards show actions in progress with data from the live conversation
- ⏱️ **Action timeline** — every action logged with status and detail
- 🌙 **Dark / Light theme** — full theme system via CSS custom properties
- 🔄 **Session resilience** — reconnection cooldown prevents cascading failures

<br/>

## Data

This project uses **synthetic demo data** shaped to reflect real hospitality workflows. No private customer, financial, or production data is included. See [docs/public-data-policy.md](docs/public-data-policy.md).

<br/>

## Deployment

Cloud Run deployment via Terraform in [`infra/`](infra/). See [`docs/`](docs/) for competition submission guidelines and cloud proof checklist.

```bash
pnpm -r build
```

<br/>

## Project Background

Inspired by [TillTech](https://till.tech)'s real-world hospitality operations platform. This is a new public thin-slice focused on live multimodal interaction and visible action execution.

See also:
- [ARCHITECTURE.md](ARCHITECTURE.md) — system design and delivery phases
- [docs/demo-script.md](docs/demo-script.md) — full demo walk-through
- [docs/brand-story.md](docs/brand-story.md) — positioning and tone

---

<div align="center">

*Built with the Gemini Live API for the Gemini Live Agent Challenge*

</div>
