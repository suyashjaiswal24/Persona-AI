// server.js
// -----------------------------------------------------------------------------
// Express backend. Plain persona chat: the model replies in the persona's own
// voice as normal text. YouTube is exposed as an OPTIONAL function-calling tool
// so the persona *can* reference its own videos when relevant, but is never
// forced to. Streams tool activity + the final reply to the browser via SSE.
// -----------------------------------------------------------------------------

import "dotenv/config";
import express from "express";
import { OpenAI } from "openai";
import { fileURLToPath } from "url";
import path from "path";

import { PERSONAS, buildSystemPrompt } from "./personas.js";
import { runYoutubeTool } from "./youtube.js";

// OpenAI function-calling tool definitions (optional for the model to use).
const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "getChannelVideos",
      description:
        "Get recent videos from this persona's own YouTube channel. Use only when the user asks for videos/resources or it clearly helps. Pass a topic to filter (e.g. 'docker', 'react') or 'latest'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Topic to filter by, or 'latest'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchChannel",
      description:
        "Search this persona's YouTube channel for videos matching a query. Returns titles + links.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term." },
        },
        required: ["query"],
      },
    },
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazily construct the OpenAI client so the server can still boot (and serve
// the UI / health check) when OPENAI_API_KEY is not set yet.
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const MAX_TOOL_ROUNDS = 4; // safety cap on tool-call round-trips per turn

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Basic env sanity check surfaced to the client.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    youtubeKey: Boolean(process.env.YOUTUBE_API_KEY),
    personas: Object.values(PERSONAS).map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      avatar: p.avatar,
      avatarImage: p.avatarImage,
    })),
  });
});

// Chat endpoint. Streams the reply as Server-Sent Events: "token" chunks as
// the model generates text, "tool_call"/"tool_result" if it looks up videos,
// then "done" with the full reply (or "error").
// Body: { personaId, message, history: [{role, content}] }
app.post("/api/chat", async (req, res) => {
  const { personaId, message, history = [] } = req.body || {};
  const persona = PERSONAS[personaId];

  // SSE headers.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!persona) {
    send("error", { message: `Unknown persona: ${personaId}` });
    return res.end();
  }
  if (!process.env.OPENAI_API_KEY) {
    send("error", { message: "OPENAI_API_KEY is not set on the server." });
    return res.end();
  }

  // Build the conversation for this turn.
  const messages = [
    { role: "system", content: buildSystemPrompt(personaId) },
    ...history, // prior user/assistant turns
    { role: "user", content: message },
  ];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const stream = await getClient().chat.completions.create({
        model: MODEL,
        stream: true,
        messages,
        // Offer YouTube tools but let the model decide (and skip them entirely).
        tools: OPENAI_TOOLS,
        tool_choice: "auto",
      });

      // Consume the stream and accumulate the final message.
      let fullText = "";
      let toolCalls = [];

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice.delta) continue;

        // Stream text tokens to browser.
        if (choice.delta.content) {
          fullText += choice.delta.content;
          send("token", { text: choice.delta.content });
        }

        // Accumulate tool calls from deltas.
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                type: "function",
                id: tc.id || "",
                function: { name: "", arguments: "" },
              };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      toolCalls = toolCalls.filter(Boolean);

      // No tool calls -> final reply (already streamed as tokens).
      if (toolCalls.length === 0) {
        send("done", { text: fullText });
        break;
      }

      // The model wants to look up videos. Add the assistant turn + calls to history.
      messages.push({
        role: "assistant",
        content: fullText,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const fnName = call.function.name;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* ignore malformed args, treat as empty */
        }
        const input = args.query ?? "latest";

        send("tool_call", { functionName: fnName, input });
        try {
          const toolResult = await runYoutubeTool(fnName, input, persona);
          send("tool_result", { functionName: fnName, input, toolResult });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        } catch (toolErr) {
          send("tool_result", {
            functionName: fnName,
            input,
            error: toolErr.message,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: toolErr.message }),
          });
        }
      }

      if (round === MAX_TOOL_ROUNDS) {
        send("error", { message: "Too many tool rounds; stopping." });
      }
    }
  } catch (err) {
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Persona AI running at http://localhost:${PORT}\n`);
});
