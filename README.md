# Tilly Live Ops

Tilly Live Ops is a public-project starter for the Gemini Live Agent Challenge.

It is designed as a new, competition-compliant thin-slice inspired by TillTech's real-world hospitality operations model. The core idea is simple: an operator talks to their business in real time, Tilly reasons across live operational context, takes safe actions, and shows visible outcomes on screen.

## Why This Exists

The private TillTech platform already proves the domain: operations, inventory, kitchen, logistics, marketing, and real business workflows. This starter turns that knowledge into a fresh public project with a clean IP and privacy boundary.

## Demo Story

The strongest narrative is a single continuous conversation during a live shift:

1. The operator asks for a quick operational rundown.
2. Tilly surfaces issues across drivers, inventory, and kitchen readiness.
3. The operator triggers corrective actions by voice.
4. The system updates the UI immediately and confirms the results.

Recommended flows:

- Driver and shift status
- Kitchen and inventory protection
- Marketing push to recover margin or move stock

## Current Starter Scope

This scaffold includes:

- a cinematic web command surface
- a Node backend with mock fallback, Google GenAI SDK planning support, backend-managed Gemini Live text sessions, and backend-managed live audio transport
- challenge and submission docs
- starter Cloud Run Terraform

This scaffold does not yet include:

- production auth
- real business integrations
- non-synthetic customer or financial data

## Repo Structure

```text
.
|-- apps/
|   |-- server/
|   `-- web/
|-- docs/
|-- infra/
|-- ARCHITECTURE.md
|-- README.md
|-- package.json
`-- pnpm-workspace.yaml
```

## Quick Start

### Requirements

- Node.js 20+
- pnpm 10+

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev
```

The web app runs on `http://localhost:5173`.
The server runs on `http://localhost:8787`.

## Public Repo Rules

- Use Gemini Live API or ADK in the final submission build.
- Keep all data synthetic unless you have explicit rights and disclosure coverage.
- Keep deployment proof and IaC in the public repo.
- Keep the demo runnable by judges without private infrastructure.

## Gemini Setup

The current starter can run in two ways:

- `mock` mode for deterministic local iteration
- `gemini`, `live`, or `auto` mode when Google GenAI credentials are configured

The current browser UI also includes:

- realtime live microphone capture that streams WAV chunks to a backend-managed Gemini Live session when `live` mode is selected
- streamed model-audio playback from the live session in the browser
- local browser speech recognition and speech synthesis fallbacks for non-live rehearsal paths

This is now a real Gemini Live prototype path rather than a browser-only voice mock. The remaining work is public-repo packaging, deployment proof, and optional replacement of synthetic actions with safe demo integrations.

If you want to test model-backed planning and live transport, configure either:

- `GOOGLE_API_KEY` for direct Gemini API usage, or
- `GOOGLE_GENAI_USE_VERTEXAI=true` with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_REGION`

## Suggested Build Order

1. Rehearse the 4-minute demo with one continuous conversation in `live` mode.
2. Deploy the same thin slice to Google Cloud Run and capture proof.
3. Finalize Devpost submission copy and architecture diagram.
4. Decide whether the public repo should stay synthetic or add safe demo integrations.
5. Complete `docs/copy-ready-checklist.md` before copying this folder into the public repo.
