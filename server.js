const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

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

async function handleChat(req, res) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return send(res, 503, {
      error: "AI is not configured yet.",
      reply: "Lucien’s interface is running, but its AI model is not connected yet. Add AI_API_KEY in your hosting environment variables, then restart the service."
    });
  }

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

  try {
    const upstream = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are Lucien, a thoughtful, clear, calm, capable AI assistant. Be warm but not overly familiar. Explain things clearly, adapt to the user's level, and be honest when you are uncertain. Use Markdown when it improves readability."
          },
          ...messages
        ],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI provider error:", upstream.status, data.error?.message || "Unknown error");
      return send(res, 502, {
        error: "The AI provider returned an error.",
        reply: "I couldn’t get a response from the AI provider just now. Check the model name and API settings, then try again."
      });
    }

    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return send(res, 502, { error: "The AI provider returned an empty response." });
    }
    return send(res, 200, { reply: reply.trim() });
  } catch (error) {
    console.error("AI request failed:", error.message);
    return send(res, 504, {
      error: "The AI request failed or timed out.",
      reply: "That request didn’t go through. Please try again in a moment."
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(req, res);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { error: "Method not allowed." });
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
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
