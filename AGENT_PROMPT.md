# Build Prompt — paste this whole file into your coding agent

You are building the core feature of **Loudmouth Labs**, a voice AI interview screener, inside this existing repo. Read the current repo structure and README first. Build the integration end to end, matching the official AssemblyAI API shape exactly — do not invent endpoints or parameters, and do not hallucinate SDK enums or voice names.

## Goal

A candidate opens the React app, clicks "Start Interview," and has a live spoken conversation with an AI interviewer in the browser. The interviewer asks adaptive follow-up questions based on what the candidate actually says (not a fixed script). When the interview naturally concludes, the agent calls a structured tool to produce a scored assessment, which the app displays.

## Product: AssemblyAI Voice Agent API (managed STT + LLM + TTS + turn detection)

## Architecture

- **Backend (Express, `/server`):**
  - `GET /api/aai-token` — calls `GET https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640` with header `Authorization: Bearer <ASSEMBLYAI_API_KEY>` (key from `process.env.ASSEMBLYAI_API_KEY`, never sent to the client). Returns `{ token }` to the frontend as JSON.
  - `POST /api/assessment` — receives the structured `tool.call` result forwarded from the frontend (or handle the tool call server-side if you prefer proxying the whole session — your call, but document which approach you took). Stores/returns it so the UI can render a results page.
  - Read `PORT` from env, default 8080. Use `dotenv` to load `.env`.

- **Frontend (React + Vite, `/client`):**
  - A "Start Interview" screen, a live transcript view during the call, and a results view after the call ends.
  - Mic capture via `AudioWorklet` (NOT `MediaRecorder` — it doesn't emit raw PCM). Capture Float32 mic samples, downsample to 24kHz mono, convert to Int16 PCM16, base64-encode, and send as `input.audio` events.
  - Play back agent audio: `reply.audio` events carry base64 PCM16 24kHz in the **`data`** field (not `audio` — that field name is only used on the input side). Decode and write to an audio output buffer/queue as it arrives — do NOT schedule playback with `setTimeout`/sleep, that causes drift and pops. Use the Web Audio API (`AudioContext`, `AudioBufferSourceNode` scheduled back-to-back, or a `ScriptProcessorNode`/`AudioWorklet` output buffer).
  - On `reply.done` with `status: "interrupted"`, flush/clear the pending output queue immediately (user barge-in).

## Connection sequence (must follow exactly)

1. Frontend fetches `{ token }` from `/api/aai-token`.
2. Connect: `wss://agents.assemblyai.com/v1/ws?token=<token>`.
3. Immediately on open, send `session.update` (don't wait for anything first):
   ```json
   {
     "type": "session.update",
     "session": {
       "system_prompt": "<see System Prompt section below>",
       "greeting": "Hi! Thanks for joining. I'll be asking you a few questions about your background and experience — just answer naturally, and I'll follow up based on what you tell me. Ready when you are.",
       "input": {
         "format": { "encoding": "audio/pcm" },
         "turn_detection": {
           "vad_threshold": 0.5,
           "min_silence": 200,
           "max_silence": 1000,
           "interrupt_response": true
         }
       },
       "output": {
         "voice": "anna",
         "format": { "encoding": "audio/pcm" }
       },
       "tools": [ /* see Tool Definition below */ ]
     }
   }
   ```
4. Wait for `{"type": "session.ready"}` before sending any `input.audio` events. Capture `session_id` from this message in case you need `session.resume` later.
5. Stream mic audio as `{"type": "input.audio", "audio": "<base64 PCM16 24kHz>"}`, ~50ms chunks (2400 bytes) is a reasonable size — exact chunk size doesn't matter, the server buffers continuously.
6. Handle these server events:
   - `input.speech.started` / `input.speech.stopped` — optional UI indicator (e.g. "listening...")
   - `transcript.user.delta` (partial) / `transcript.user` (final) — show live transcript of the candidate
   - `reply.started` — agent begins responding
   - `reply.audio` — base64 PCM16 in `data` field, queue for playback
   - `transcript.agent` — show what the agent said, for the live transcript view
   - `reply.done` — check `status`; if `"interrupted"`, flush output audio buffer
   - `tool.call` — `{ call_id, name, arguments }`. When `name === "record_assessment"`, parse `arguments`, send the result to `/api/assessment` on our own backend, then send back `{"type": "tool.result", "call_id": "<call_id>", "result": {"status": "recorded"}}` over the same WebSocket AFTER the current `reply.done` has fired.
7. To end the interview (either the candidate clicks "End" or the assessment tool has fired): send `{"type": "session.end"}`. The server responds with `session.ended` and billing stops immediately.

## System prompt (use this, refine wording as needed but keep the structure)

```
You are conducting a first-round screening interview for a software engineering role. Your job:

1. Ask one question at a time. Wait for the full answer before responding.
2. Start broad (background, recent experience), then go deeper based on what the candidate actually says — if they mention a specific project or technology, ask a genuine follow-up about it rather than moving to a generic next question.
3. Cover in total: background/experience, a technical topic relevant to what they mentioned, and one behavioral/collaboration question. Aim for 5-8 exchanges total.
4. Keep your own responses short and conversational — this is a spoken conversation, not a written one. No bullet points, no long monologues.
5. When you have enough signal to assess the candidate (or after covering the topics above), thank them for their time, let them know the interview is wrapping up, and then call the record_assessment tool with your evaluation. Do not narrate that you're "calling a tool" — just naturally conclude the conversation and invoke it.
```

## Tool definition (flat schema — NOT OpenAI's nested function-calling shape)

```json
{
  "type": "function",
  "name": "record_assessment",
  "description": "Record the structured outcome of the interview once it has concluded.",
  "parameters": {
    "type": "object",
    "properties": {
      "skills": { "type": "array", "items": { "type": "string" }, "description": "Key skills or technologies the candidate demonstrated or mentioned." },
      "red_flags": { "type": "array", "items": { "type": "string" }, "description": "Any concerns, inconsistencies, or gaps noticed. Empty array if none." },
      "notable_quotes": { "type": "array", "items": { "type": "string" }, "description": "Short, specific things the candidate said that stood out, positive or negative." },
      "score": { "type": "number", "description": "Overall assessment score from 1-10." },
      "recommendation": { "type": "string", "description": "One of: strong_yes, yes, maybe, no, strong_no" }
    },
    "required": ["skills", "red_flags", "notable_quotes", "score", "recommendation"]
  }
}
```

## Constraints

- Use the raw AssemblyAI WebSocket/HTTP API directly (no SDK) — this repo should have minimal dependencies.
- The `ASSEMBLYAI_API_KEY` must only ever be read server-side via `process.env`. Never send it to the client, never hardcode it.
- The Voice Agent API requires `Authorization: Bearer <key>` — note this is different from AssemblyAI's other products (STT, LLM Gateway), which take the raw key with no `Bearer` prefix. Don't get this backwards.
- `session.update`'s `greeting`, `output.voice`, and `output.format` are immutable after `session.ready` — don't try to change them mid-session. `system_prompt`, `input.turn_detection`, `input.keyterms`, `output.volume`, and `tools` ARE mutable (send another `session.update` if you need to change them later).
- Handle WebSocket close codes gracefully: `1008` (unauthorized — token expired or invalid), `3005` (session cancelled server-side). Surface a clear error state in the UI rather than failing silently.
- If reconnecting after an unexpected disconnect within 30 seconds, mint a fresh token and send `session.resume` with the saved `session_id` to preserve conversation context. After 30 seconds, just start a new session.
- Voice IDs are exact strings and can change — if `"anna"` is rejected at `session.update`, check `GET https://agents.assemblyai.com/v1/voices` for the current valid list rather than guessing a replacement.

## Deliverables

1. Working `server/index.js`, `server/routes/token.js`, `server/toolHandler.js`.
2. Working React app in `client/src/` — at minimum: `App.jsx`, a `useVoiceAgent.js` hook (WebSocket + audio lifecycle), and an `InterviewScreen.jsx` component (start/stop UI, live transcript, results view).
3. `server/package.json` and `client/package.json` with only the dependencies actually used (Express, dotenv, cors for the server; React + Vite for the client — no extra libraries unless genuinely needed for audio handling).
4. Basic error handling as described above.
5. Don't touch `README.md` or `.env.example` — they're already written; update them only if your implementation deviates from what they describe.

Ask me before writing code if anything here is ambiguous — particularly around exactly how you want to split tool-call handling between frontend and backend, if you'd prefer a different approach than what's sketched above.
