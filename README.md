# Loudmouth Labs

A voice agent that conducts live first-round interviews. It listens in real time, asks adaptive follow-up questions based on what the candidate actually says, and produces a structured scored summary at the end — skills, red flags, notable quotes, and a recommendation.

Built for the AssemblyAI Voice Agent Hackathon on lablab.ai (Sep 2026), using AssemblyAI's Voice Agent API.

## How it works

1. Candidate opens the web app and clicks "Start Interview."
2. The React frontend gets a short-lived AssemblyAI token from our Express backend (the real API key never reaches the browser).
3. The frontend connects directly to AssemblyAI's Voice Agent WebSocket, streams mic audio, and plays back the agent's spoken responses.
4. The agent asks questions, listens, and adapts based on answers.
5. When the interview wraps up, the agent calls a `record_assessment` tool with structured JSON (skills, red flags, quotes, score, recommendation), which the backend receives and the frontend displays.

## Project structure

```
loudmouth-labs/
├── AGENT_PROMPT.md      # Full build spec — paste this into your coding agent (Codex/Cursor/etc.)
├── server/              # Express backend: mints AssemblyAI tokens, handles tool-call results
│   ├── index.js
│   ├── routes/token.js
│   └── toolHandler.js
├── client/               # React frontend: mic capture, WebSocket, live transcript, results view
│   └── src/
└── .env.example
```

## Setup

### 1. Get an AssemblyAI API key
You already have one — grab it from [assemblyai.com/dashboard/api-keys](https://www.assemblyai.com/dashboard/api-keys).

### 2. Configure environment variables
```bash
cp .env.example server/.env
# then edit server/.env and paste in your key
```

### 3. Install dependencies
```bash
cd server && npm install
cd ../client && npm install
```

### 4. Run it
```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```
Open the client at the URL Vite prints (usually `http://localhost:5173`).

## Building the actual feature code

This repo is scaffolded but the core logic (mic capture, WebSocket lifecycle, tool handling, UI) is NOT yet written. Open `AGENT_PROMPT.md` and paste its full contents into your coding agent (Codex, Cursor, Claude Code, etc.) inside this repo — it contains the complete spec, API shape, and constraints needed to build it correctly in one pass.

## Environment variables

| Variable | Description |
|---|---|
| `ASSEMBLYAI_API_KEY` | Your AssemblyAI API key. Server-side only — never exposed to the client. |
| `PORT` | Port for the Express server (default 8080). |

## Notes for the hackathon submission

- Check the hackathon page for exact submission requirements (typically: working prototype, GitHub repo link, and a short demo video).
- Keep the demo focused: one full mock interview, then show the structured JSON result on screen — that's the "wow" moment for judges.
