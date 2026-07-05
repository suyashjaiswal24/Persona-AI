# Persona AI — Hitesh Choudhary & Piyush Garg

A web chatbot that lets you talk to AI personas of **Hitesh Choudhary** and
**Piyush Garg**. Each persona replies in its own voice, tone, and language mix,
and can optionally pull real videos from its own YouTube channel into the
conversation.

**Live demo:** _add your deployed URL here_
**Repo:** https://github.com/suyashjaiswal24/Persona-AI

## Stack
- **Backend:** Node.js + Express, OpenAI SDK (`gpt-4o`), streamed responses (SSE)
- **Tools:** YouTube Data API v3 (persona-scoped video search), exposed to the
  model via OpenAI function calling
- **Frontend:** vanilla HTML/CSS/JS — persona switcher, live token streaming,
  reasoning/tool trace, video thumbnail cards

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create your `.env` from the template and fill in keys:
   ```bash
   cp .env.example .env
   ```
   - `OPENAI_API_KEY` — from https://platform.openai.com/api-keys
   - `OPENAI_MODEL` — defaults to `gpt-4o`
   - `YOUTUBE_API_KEY` — enable "YouTube Data API v3" at
     https://console.cloud.google.com/ and create an API key

3. Run:
   ```bash
   npm start
   ```
   Open http://localhost:3000

## How it works

1. Pick a persona (Hitesh or Piyush) in the sidebar.
2. Your message + prior turns for that persona are sent to `/api/chat`.
3. The backend calls OpenAI with the persona's system prompt and streams the
   reply back token-by-token over Server-Sent Events, so text appears live.
4. If the model decides a video would help, it calls one of two tools
   (`getChannelVideos` / `searchChannel`) scoped to that persona's YouTube
   channel. Results render as clickable thumbnail cards above the reply.
5. Switching personas starts a fresh conversation (each persona's history is
   independent — no cross-contamination of voice or context).

## Documentation

### 1. How the persona data was collected and prepared
Each persona's system prompt in [personas.js](personas.js) was hand-authored
from publicly observable traits of the real creators — their known
catchphrases, teaching style, and language mix, based on how they speak in
their videos:

- **Hitesh Choudhary** — "Chai aur Code" branding, opens with "Hanji",
  Hindi-first/English-for-jargon mixing, calm/patient tone, recurring lines
  ("Baaki, Azaad Desh hai...", "Rabbithole", "Fancy names"), and a hard rule
  to never write/execute code — only explain and redirect to self-practice.
- **Piyush Garg** — sarcastic tone, Hindi-first, recurring bits (Karan Aujla
  references, joking about breakups), his real professional background
  (Principal Engineer at Oraczen, founder of Teachyst), and the same
  no-code-execution rule.

No scraped transcripts or third-party datasets are used — prompts are curated
example-driven descriptions (traits + a few sample Q&A exchanges) rather than
fine-tuning data. Each persona also owns a real YouTube `channelId` so video
lookups return actual videos from that person's channel.

### 2. Prompt engineering strategy
- **System prompt = full persona spec.** Each prompt packs: identity,
  speaking style/language mix, recurring phrases, teaching philosophy, and
  explicit behavioral constraints (e.g. "never write or execute code — tell
  the user to try it themselves").
- **Few-shot examples inside the prompt.** Hitesh's prompt includes sample
  Hitesh↔user exchanges so tone and phrasing are demonstrated, not just
  described — this anchors word choice better than adjectives alone.
- **Tool use is optional, not scripted.** An earlier version forced a strict
  JSON step pipeline (INITIAL/THINK/TOOL_REQUEST/OUTPUT) so the model would
  always narrate its reasoning. That was dropped in favor of plain
  conversational replies with OpenAI **function calling** (`tool_choice:
  "auto"`) — the model only calls `getChannelVideos`/`searchChannel` when a
  video genuinely helps, matching how these personas actually talk (they
  don't narrate a reasoning pipeline out loud).
- **Guardrails baked into the prompt itself**, not the code — e.g. "don't
  write code" is enforced by instruction, keeping persona behavior legible
  and easy to tune without touching `server.js`.

### 3. Context management approach
- **Per-persona, per-session history.** The browser keeps a `history` array
  of `{role, content}` turns for the *currently selected* persona only.
  Switching personas clears it — each persona starts a clean conversation
  and never sees the other's history or voice.
- **System prompt is re-sent every turn**, not just once — this keeps
  persona identity anchored even in long conversations, since OpenAI's chat
  API is stateless per-request (`buildSystemPrompt()` in `personas.js`
  builds it fresh each call).
- **Server is stateless.** No session store — the client sends the full
  running history each request. This keeps the backend simple and
  horizontally scalable, at the cost of the client owning conversation state
  (acceptable for a single-session demo chatbot).
- **Tool round-trips stay in the same turn.** When a tool is called, the
  tool call + its result are appended to the *in-flight* message list and
  fed back to the model immediately (bounded by `MAX_TOOL_ROUNDS = 4`), so
  the model can reason over real video data before producing its final
  reply — without that back-and-forth polluting the persisted `history`.

### 4. Sample conversations

**Hitesh Choudhary:**
> **User:** Sir guidance chahiye Web Development ke liye
> **Hitesh:** Dekho yaar! Start karo basics se like HTML, CSS, and
> JavaScript. Fir aap start karo mini projects banane... Baaki, Azaad Desh
> hai, jo karna ho karo, kon rokne wala hai.

> **User:** aapki koi javascript ki video hai? link do
> **Hitesh:** *(calls `searchChannel("javascript")`)* → replies with 5 real
> videos from Hitesh's channel as clickable thumbnails, described in his
> own voice ("Ye video JavaScript ke beginners ke liye ekdam perfect hai...").

**Piyush Garg:**
> **User:** Hi!
> **Piyush:** Hello Hello Hello, kaise ho sab! Chalo bhai, kya seekhna hai
> aaj?

> **User:** Docker samjhao
> **Piyush:** Shuru se shuru karte hai! Socho ek waqt tha jab sab log apne
> apne machine pe app chalate the, environment mismatch hota tha, "mere
> machine pe chalta hai" wali problem... *(explains Docker's origin story,
> then internals — consistent with his "explain from scratch with a story"
> and "rabbithole into internals" style)*.

## Files
- `server.js` — Express server, OpenAI streaming chat + tool-calling loop
- `personas.js` — persona system prompts + YouTube channel IDs (**edit here
  to add/change a persona**)
- `youtube.js` — YouTube Data API v3 tool implementations
- `public/` — chat UI (`index.html`, `styles.css`, `app.js`)
- `public/images/` — persona profile photos (falls back to emoji if missing)
