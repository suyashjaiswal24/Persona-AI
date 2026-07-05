// app.js — frontend chat logic + SSE pipeline rendering.

const state = {
  personaId: null,
  personas: [],
  busy: false,
};

// Per-persona conversation memory, keyed by personaId. Each entry keeps the
// API history (for context) and the rendered chat HTML (so switching back to
// a persona restores exactly what was on screen before).
const sessions = {};

function getSession(personaId) {
  if (!sessions[personaId]) {
    sessions[personaId] = { history: [], html: "" };
  }
  return sessions[personaId];
}

const els = {
  personaList: document.getElementById("personaList"),
  statusBox: document.getElementById("statusBox"),
  messages: document.getElementById("messages"),
  headerAvatarSlot: document.getElementById("headerAvatarSlot"),
  headerName: document.getElementById("headerName"),
  headerTagline: document.getElementById("headerTagline"),
  form: document.getElementById("composer"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("sendBtn"),
};

// Renders an avatar as a photo <img> if avatarImage is set, else an emoji.
// onerror falls back to the emoji span so a missing/broken image never
// leaves a blank box.
function avatarHtml(p, sizeClass = "") {
  const emoji = p?.avatar || "🤖";
  if (p?.avatarImage) {
    return `<img class="avatar-img ${sizeClass}" src="${p.avatarImage}" alt="${escapeHtml(
      p.name || ""
    )}" onerror="this.outerHTML='<div class=\\'avatar ${sizeClass}\\'>${emoji}</div>'" />`;
  }
  return `<div class="avatar ${sizeClass}">${emoji}</div>`;
}

// ---------- Init: load personas + health ----------
async function init() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    state.personas = data.personas || [];
    renderPersonas();
    renderStatus(data);
  } catch (e) {
    els.statusBox.innerHTML = `<span class="bad">Server unreachable.</span> Run <code>npm start</code>.`;
  }
}

function renderStatus(data) {
  const line = (label, ok) =>
    `${label}: <span class="${ok ? "ok" : "bad"}">${ok ? "ready" : "missing"}</span>`;
  els.statusBox.innerHTML = `${line("OpenAI key", data.openaiKey)}<br/>${line(
    "YouTube key",
    data.youtubeKey
  )}`;
}

function renderPersonas() {
  els.personaList.innerHTML = "";
  state.personas.forEach((p) => {
    const card = document.createElement("div");
    card.className = "persona-card";
    card.dataset.id = p.id;
    card.innerHTML = `
      ${avatarHtml(p)}
      <div>
        <div class="p-name">${p.name}</div>
        <div class="p-tag">${p.tagline || ""}</div>
      </div>`;
    card.addEventListener("click", () => selectPersona(p));
    els.personaList.appendChild(card);
  });
}

function selectPersona(p) {
  if (state.busy) return;

  // Save the outgoing persona's rendered chat before switching away.
  if (state.personaId) {
    getSession(state.personaId).html = els.messages.innerHTML;
  }

  state.personaId = p.id;

  // Restore this persona's prior chat, or show the empty state if it's new.
  const session = getSession(p.id);
  els.messages.innerHTML =
    session.html ||
    `<div class="empty-state">
       <div class="empty-emoji">🎙️</div>
       <p>Select a persona and ask anything about code, careers, or their videos.</p>
     </div>`;
  scrollDown();

  document
    .querySelectorAll(".persona-card")
    .forEach((c) => c.classList.toggle("active", c.dataset.id === p.id));

  els.headerAvatarSlot.innerHTML = avatarHtml(p, "header-avatar");
  els.headerName.textContent = p.name;
  els.headerTagline.textContent = p.tagline || "";

  els.input.disabled = false;
  els.sendBtn.disabled = false;
  els.input.focus();
}

// ---------- Message rendering helpers ----------
function clearEmptyState() {
  els.messages.querySelector(".empty-state")?.remove();
}

function addUserMessage(text) {
  clearEmptyState();
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<div class="bubble"></div>`;
  div.querySelector(".bubble").textContent = text;
  els.messages.appendChild(div);
  scrollDown();
}

function currentPersona() {
  return state.personas.find((p) => p.id === state.personaId) || null;
}

function createTyping() {
  const p = currentPersona();
  const div = document.createElement("div");
  div.className = "msg bot";
  div.innerHTML = `${avatarHtml(p, "msg-avatar")}<div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>`;
  els.messages.appendChild(div);
  scrollDown();
  return div;
}

function createTrace() {
  const trace = document.createElement("div");
  trace.className = "trace";
  trace.innerHTML = `<div class="trace-title">Referenced videos</div>`;
  els.messages.appendChild(trace);
  scrollDown();
  return trace;
}

function addTraceStep(trace, step, text) {
  const row = document.createElement("div");
  row.className = "trace-step";
  row.innerHTML = `<span class="tag ${step}">${step}</span><span class="step-text"></span>`;
  row.querySelector(".step-text").textContent = text || "";
  trace.appendChild(row);
  scrollDown();
}

function addToolCard(trace, payload) {
  if (payload.error) {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.textContent = `⚠ ${payload.functionName}("${payload.input}") → ${payload.error}`;
    trace.appendChild(card);
    scrollDown();
    return;
  }

  const vids = payload.toolResult?.videos || [];
  const header = document.createElement("div");
  header.className = "tool-card-header";
  header.textContent = `▶ ${payload.functionName}("${payload.input || "latest"}") → ${vids.length} videos`;
  trace.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "video-grid";
  vids.forEach((v) => {
    const link = document.createElement("a");
    link.className = "video-card";
    link.href = v.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.innerHTML = `
      <div class="video-thumb-wrap">
        <img class="video-thumb" src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy" />
        <span class="video-play">▶</span>
      </div>
      <div class="video-title">${escapeHtml(v.title)}</div>
    `;
    grid.appendChild(link);
  });
  trace.appendChild(grid);
  scrollDown();
}

function addBotMessage(text) {
  const p = currentPersona();
  const div = document.createElement("div");
  div.className = "msg bot";
  div.innerHTML = `${avatarHtml(p, "msg-avatar")}<div class="bubble"></div>`;
  div.querySelector(".bubble").textContent = text;
  els.messages.appendChild(div);
  scrollDown();
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- Send / SSE stream ----------
async function sendMessage(message) {
  state.busy = true;
  els.sendBtn.disabled = true;
  els.input.disabled = true;

  addUserMessage(message);

  // Add a placeholder for the bot's reply that will stream in via tokens.
  const botDiv = document.createElement("div");
  botDiv.className = "msg bot";
  botDiv.innerHTML = `${avatarHtml(currentPersona(), "msg-avatar")}<div class="bubble"></div>`;
  els.messages.appendChild(botDiv);
  const bubbleEl = botDiv.querySelector(".bubble");
  scrollDown();

  // Lazily add trace for tool activity.
  let trace = null;
  const ensureTrace = () => {
    if (!trace) {
      trace = createTrace();
    }
    return trace;
  };

  const personaId = state.personaId;
  const session = getSession(personaId);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personaId,
      message,
      history: session.history,
    }),
  });

  if (!res.ok || !res.body) {
    botDiv.remove();
    addTraceStep(ensureTrace(), "OUTPUT", "Request failed.");
    finishTurn();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop(); // keep incomplete chunk

    for (const chunk of chunks) {
      const evMatch = chunk.match(/event: (.+)/);
      const dataMatch = chunk.match(/data: (.+)/s);
      if (!evMatch || !dataMatch) continue;
      const event = evMatch[1].trim();
      const data = JSON.parse(dataMatch[1]);

      if (event === "token") {
        // Stream text directly to the bubble as it arrives.
        bubbleEl.textContent += data.text;
        finalText += data.text;
        scrollDown();
      } else if (event === "tool_call") {
        addTraceStep(ensureTrace(), "TOOL", `Looking up: ${data.functionName}("${data.input}")`);
      } else if (event === "tool_result") {
        addToolCard(ensureTrace(), data);
      } else if (event === "done") {
        finalText = data.text;
        bubbleEl.textContent = finalText;
      } else if (event === "error") {
        addTraceStep(ensureTrace(), "OUTPUT", `⚠ ${data.message}`);
      }
    }
  }

  if (trace) trace.querySelector(".trace-title").textContent = "Referenced videos";

  if (finalText) {
    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: finalText });
  }
  // Keep the saved snapshot in sync in case the user switches persona
  // immediately after this reply finishes.
  session.html = els.messages.innerHTML;
  finishTurn();
}

function finishTurn() {
  state.busy = false;
  els.sendBtn.disabled = false;
  els.input.disabled = false;
  els.input.focus();
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = els.input.value.trim();
  if (!message || state.busy || !state.personaId) return;
  els.input.value = "";
  sendMessage(message);
});

init();
