# Persona AI — Hitesh Choudhary & Piyush Garg

A web chatbot that lets you talk to AI personas of **Hitesh Choudhary** and
**Piyush Garg**. Each persona can call its own **YouTube channel** as a tool
(via the official YouTube Data API) to pull real videos into the conversation.

Built on the INITIAL → THINK → TOOL_REQUEST → ANALYSE → OUTPUT chain-of-thought
pipeline (adapted from `04_cot_tool.js`), streamed step-by-step to the browser.

## Stack
- **Backend:** Node + Express, OpenAI SDK (`gpt-4o`)
- **Tools:** YouTube Data API v3
- **Frontend:** vanilla HTML/CSS/JS chat UI with a live reasoning trace

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
   - `YOUTUBE_API_KEY` — enable "YouTube Data API v3" at
     https://console.cloud.google.com/ and create an API key

3. Configure the two things I left as placeholders:
   - **System prompts** in `personas.js` (paste the prompts you provide).
   - **YouTube channel IDs** in `personas.js` (`youtubeChannelId` for each).
     Get a channel ID from the channel page → *…more* → *Share channel* →
     *Copy channel ID* (starts with `UC...`).

4. Run:
   ```bash
   npm start
   ```
   Open http://localhost:3000

## How it works
- Pick a persona in the sidebar.
- Ask a question. The backend runs the CoT pipeline; each step (INITIAL /
  THINK / ANALYSE / TOOL_REQUEST) streams to the browser as a reasoning trace.
- When the model emits a `TOOL_REQUEST`, the server calls the YouTube tool for
  that persona's channel and feeds the result back into the loop.
- The final `OUTPUT` renders as the persona's chat reply.

## Files
- `server.js` — Express server + SSE pipeline loop
- `personas.js` — persona definitions + system prompts (**edit these**)
- `youtube.js` — YouTube Data API tools
- `public/` — chat UI (`index.html`, `styles.css`, `app.js`)
