const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SYSTEM_PROMPT = "You are Lucien, a thoughtful, clear, capable AI assistant. Be warm but not overly familiar. Explain things clearly, adapt to the user's level, and be honest when uncertain. Use Markdown when it improves readability.";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body too large");
  }
  return JSON.parse(body || "{}");
}

function errorStatus(error) {
  return Number(error?.status || error?.statusCode || error?.code) || 0;
}

function errorMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 900);
}

async function callOpenAICompatible(provider, apiKey, baseURL, model, messages) {
  const response = await fetch(baseURL.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7
    }),
    signal: AbortSignal.timeout(45000)
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || raw.slice(0, 300) || response.statusText;
    const error = new Error(provider + " returned HTTP " + response.status + ": " + detail);
    error.status = response.status;
    throw error;
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error(provider + " returned an empty response.");
  }
  return reply.trim();
}

async function callGemini(apiKey, model, messages) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const transcript = messages.map(m =>
    (m.role === "user" ? "User" : "Lucien") + ":\n" + m.content
  ).join("\n\n");

  const interaction = await ai.interactions.create({
    model,
    store: false,
    input: SYSTEM_PROMPT + "\n\nContinue this conversation, replying to the final User message. Treat earlier messages as conversation history.\n\n" + transcript
  });
  const reply = interaction.output_text;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("Gemini returned an empty response.");
  return reply.trim();
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return send(res, 400, { error: "Please send valid JSON." });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return send(res, 400, { error: "Please include at least one message." });
  }

  const messages = payload.messages
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-40)
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return send(res, 400, { error: "The latest message must be from the user." });
  }

  // Try free-tier providers in this order. Only providers with configured keys are used.
  // Gemini stays supported, so the existing Railway key continues to work.
  const providers = [];
  const groqKey = process.env.GROQ_API_KEY;
  const kiloKey = process.env.KILO_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const llm7Key = process.env.LLM7_API_KEY;
  const geminiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY;

  if (groqKey) providers.push({
    name: "Groq", run: () => callOpenAICompatible("Groq", groqKey,
      process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      process.env.GROQ_MODEL || "openai/gpt-oss-120b", messages)
  });
  if (kiloKey) providers.push({
    name: "Kilo", run: () => callOpenAICompatible("Kilo", kiloKey,
      process.env.KILO_BASE_URL || "https://api.kilo.ai/api/gateway",
      process.env.KILO_MODEL || "kilo-auto/free", messages)
  });
  if (mistralKey) providers.push({
    name: "Mistral", run: () => callOpenAICompatible("Mistral", mistralKey,
      process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1",
      process.env.MISTRAL_MODEL || "mistral-small-latest", messages)
  });
  if (llm7Key) providers.push({
    name: "LLM7", run: () => callOpenAICompatible("LLM7", llm7Key,
      process.env.LLM7_BASE_URL || "https://api.llm7.io/v1",
      process.env.LLM7_MODEL || "default", messages)
  });
  if (geminiKey) providers.push({
    name: "Gemini", run: () => callGemini(geminiKey,
      (process.env.AI_MODEL || "gemini-3.8-flash").trim(), messages)
  });

  if (!providers.length) {
    return send(res, 503, {
      error: "No AI provider is configured.",
      reply: "Lucien's website is running, but no AI provider key is configured. Add GROQ_API_KEY or another supported provider key in Railway Variables."
    });
  }

  const failures = [];
  for (const provider of providers) {
    try {
      const reply = await provider.run();
      console.log("Chat answered by " + provider.name + ".");
      return send(res, 200, { reply, provider: provider.name });
    } catch (error) {
      const status = errorStatus(error);
      const message = errorMessage(error);
      // Keep trying other providers on quota/rate-limit, auth, model, and temporary server errors.
      console.error(provider.name + " request failed (" + (status || "unknown") + "): " + message);
      failures.push({ provider: provider.name, status, message });
    }
  }

  const allRateLimited = failures.every(f => f.status === 429 || /quota|rate.?limit|resource_exhausted/i.test(f.message));
  const anyAuth = failures.some(f => f.status === 401 || f.status === 403 || /unauthorized|invalid api key|permission denied/i.test(f.message));
  let reply = "Lucien couldn't get a response from any configured AI provider. Please try again shortly.";
  if (allRateLimited) {
    reply = "All configured AI providers have reached their current free-tier quota or rate limit. Try again later, or add another provider key in Railway Variables.";
  } else if (anyAuth) {
    reply = "The configured AI providers rejected their API credentials. Check the provider keys in Railway Variables; Lucien tried the available fallbacks too.";
  }
  return send(res, 502, {
    error: "All configured AI providers failed.",
    reply,
    providersTried: failures.map(f => f.provider)
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(req, res);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { error: "Method not allowed." });
  }

  let pathname;
  try { pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname); }
  catch { return send(res, 400, { error: "Invalid path." }); }

  const filePath = path.resolve(ROOT, "." + pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    return send(res, 403, { error: "Forbidden." });
  }

  fs.readFile(filePath, (error, file) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(req.method === "HEAD" ? undefined : file);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Lucien listening on port " + PORT);
});
