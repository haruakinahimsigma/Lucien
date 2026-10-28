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
  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
  const model = (process.env.AI_MODEL || "gemini-3.8-flash").trim();

  if (!apiKey) {
    return send(res, 503, {
      error: "AI is not configured yet.",
      reply: "Lucien's interface is running, but its Gemini API key is missing. Add AI_API_KEY in Railway's environment variables."
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
    // Use Google's official SDK and the Interactions API from the AI Studio quickstart.
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const transcript = messages.map(m =>
      (m.role === "user" ? "User" : "Lucien") + ":\n" + m.content
    ).join("\n\n");

    const interaction = await ai.interactions.create({
      model,
      store: false,
      input:
        "You are Lucien, a thoughtful, clear, capable AI assistant. Be warm but not overly familiar. Explain things clearly, adapt to the user's level, and be honest when uncertain. Use Markdown when it improves readability.\n\n" +
        "Continue this conversation, replying to the final User message. Treat earlier messages as conversation history.\n\n" +
        transcript
    });

    const reply = interaction.output_text;
    if (typeof reply !== "string" || !reply.trim()) {
      console.error("Gemini Interactions API returned no output text.");
      return send(res, 502, {
        error: "Gemini returned an empty response.",
        reply: "Gemini returned an empty response. Please try again."
      });
    }
    return send(res, 200, { reply: reply.trim() });
  } catch (error) {
    // Log the provider error for debugging, never log the API key.
    const status = error?.status || error?.code || "unknown";
    const message = String(error?.message || error || "Unknown error").slice(0, 1200);
    console.error("Gemini Interactions API error:", status, message);

    const lower = message.toLowerCase();
    let reply = "Lucien couldn't get a response from Gemini just now. Please try again shortly.";
    if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("permission denied") || status === 401 || status === 403) {
      reply = "Gemini rejected the API credentials or permissions. Check that AI_API_KEY in Railway is a valid Gemini API key from Google AI Studio.";
    } else if (lower.includes("quota") || lower.includes("resource_exhausted") || status === 429) {
      reply = "Gemini's API quota or rate limit was reached. Check usage and limits in Google AI Studio, then try again later.";
    } else if (lower.includes("not found") || status === 404) {
      reply = "Gemini couldn't find that model or API endpoint. Check the AI_MODEL value in Railway.";
    } else if (status === 503 || lower.includes("unavailable")) {
      reply = "Gemini is temporarily unavailable. Wait a little and try again.";
    }
    return send(res, 502, { error: "Gemini request failed.", reply });
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
