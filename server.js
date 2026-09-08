import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import "dotenv/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const databasePath =
  process.env.SQLITE_DB_PATH || join(root, "data", "history.db");
const dataDirectory = dirname(databasePath);
mkdirSync(dataDirectory, { recursive: true });
const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS saved_contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    line_count INTEGER NOT NULL,
    saved_at INTEGER NOT NULL
  )
`);
const port = Number(process.env.PORT || 3000);
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = "JBFqnCBsd6RMkjVDRZzb";
const modelId = "eleven_v3";
const translationCache = new Map();
const keepAliveUrl =
  process.env.KEEP_ALIVE_URL ||
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL;
const keepAliveInterval = 10 * 60 * 1000;
let lastUserRequestAt = Date.now();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function handleHealthCheck(response) {
  sendJson(response, 200, { status: "ok" });
}

function handleGetHistory(response) {
  const savedContents = database
    .prepare(
      `SELECT id, title, content, line_count AS lineCount, saved_at AS savedAt
       FROM saved_contents ORDER BY saved_at DESC, id DESC LIMIT 20`,
    )
    .all();
  sendJson(response, 200, savedContents);
}

async function handleCreateHistory(request, response) {
  try {
    const { title, content, lineCount } = JSON.parse(await readBody(request));
    if (
      typeof title !== "string" ||
      typeof content !== "string" ||
      !content.trim() ||
      !Number.isInteger(lineCount) ||
      lineCount < 1
    ) {
      sendJson(response, 400, { error: "Invalid saved content" });
      return;
    }

    const result = database
      .prepare(
        `INSERT INTO saved_contents (title, content, line_count, saved_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(title.trim().slice(0, 100), content.trim(), lineCount, Date.now());
    const savedContent = database
      .prepare(
        `SELECT id, title, content, line_count AS lineCount, saved_at AS savedAt
         FROM saved_contents WHERE id = ?`,
      )
      .get(result.lastInsertRowid);
    sendJson(response, 201, savedContent);
  } catch {
    sendJson(response, 400, { error: "Invalid history request" });
  }
}

async function handleDeleteHistory(request, response) {
  const historyId = Number(request.url.split("/").pop());
  if (!Number.isInteger(historyId) || historyId < 1) {
    sendJson(response, 400, { error: "Invalid history id" });
    return;
  }
  const result = database
    .prepare("DELETE FROM saved_contents WHERE id = ?")
    .run(historyId);
  if (!result.changes) {
    sendJson(response, 404, { error: "History item not found" });
    return;
  }
  response.writeHead(204);
  response.end();
}

function startKeepAlive() {
  if (!keepAliveUrl) {
    console.warn(
      "Keep-alive chưa bật: hãy cấu hình KEEP_ALIVE_URL hoặc APP_URL.",
    );
    return;
  }

  setInterval(async () => {
    if (Date.now() - lastUserRequestAt < keepAliveInterval) return;

    try {
      const response = await fetch(`${keepAliveUrl}/api/health`, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "French-Loop-Keep-Alive" },
      });
      if (!response.ok) {
        console.warn(`Keep-alive HTTP ${response.status}`);
        return;
      }
      console.log("Keep-alive ping thành công");
    } catch (error) {
      console.warn("Keep-alive thất bại:", error.message);
    }
  }, keepAliveInterval).unref();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function handleTextToSpeech(request, response) {
  try {
    const { text } = JSON.parse(await readBody(request));

    if (typeof text !== "string" || !text.trim()) {
      sendJson(response, 400, { error: "Text is required" });
      return;
    }

    if (!elevenLabsApiKey) {
      sendJson(response, 500, {
        error: "ELEVENLABS_API_KEY is missing",
      });
      return;
    }

    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "xi-api-key": elevenLabsApiKey,
        },

        body: JSON.stringify({
          text: text.trim(),

          // Model
          model_id: "eleven_v3",

          // Explicitly tell ElevenLabs that the text is French
          language_code: "fr",

          // Natural French delivery
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true,
          },

          output_format: "mp3_44100_128",
        }),

        signal: AbortSignal.timeout(15000),
      },
    );

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error("ElevenLabs error:", errorText);

      throw new Error(`ElevenLabs HTTP ${elevenLabsResponse.status}`);
    }

    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    });

    Readable.fromWeb(elevenLabsResponse.body).pipe(response);
  } catch (error) {
    console.error("ElevenLabs TTS error:", error.message);

    sendJson(response, 502, {
      error: "Unable to generate French audio",
    });
  }
}

async function handleTranslation(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const query = requestUrl.searchParams.get("q")?.trim();

  if (!query || Buffer.byteLength(query, "utf8") > 500) {
    sendJson(response, 400, { error: "A word up to 500 bytes is required" });
    return;
  }

  const cachedTranslation = translationCache.get(query.toLowerCase());
  if (cachedTranslation) {
    sendJson(response, 200, { translatedText: cachedTranslation });
    return;
  }

  const providers = [
    async () => {
      const translationUrl = new URL(
        "https://translate.googleapis.com/translate_a/single",
      );
      translationUrl.searchParams.set("client", "gtx");
      translationUrl.searchParams.set("sl", "fr");
      translationUrl.searchParams.set("tl", "vi");
      translationUrl.searchParams.set("dt", "t");
      translationUrl.searchParams.set("q", query);
      const translationResponse = await fetch(translationUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!translationResponse.ok) {
        throw new Error(`Google Translate HTTP ${translationResponse.status}`);
      }
      const data = await translationResponse.json();
      return data[0]
        ?.map((segment) => segment[0])
        .filter(Boolean)
        .join("")
        .trim();
    },
    async () => {
      const translationUrl = new URL("https://api.mymemory.translated.net/get");
      translationUrl.searchParams.set("q", query);
      translationUrl.searchParams.set("langpair", "fr|vi");
      if (process.env.MYMEMORY_EMAIL) {
        translationUrl.searchParams.set("de", process.env.MYMEMORY_EMAIL);
      }
      const translationResponse = await fetch(translationUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!translationResponse.ok) {
        throw new Error(`MyMemory HTTP ${translationResponse.status}`);
      }
      const data = await translationResponse.json();
      return data.responseData?.translatedText?.trim();
    },
  ];

  for (const provider of providers) {
    try {
      const translatedText = await provider();
      if (translatedText) {
        translationCache.set(query.toLowerCase(), translatedText);
        sendJson(response, 200, { translatedText });
        return;
      }
    } catch (error) {
      console.error("Translation provider error:", error.message);
    }
  }

  sendJson(response, 502, { error: "Unable to translate this word" });
}

function serveFile(request, response) {
  const requestedPath =
    request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filePath = normalize(join(root, requestedPath));
  if (
    !filePath.startsWith(root) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

const requestHandler = async (request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    handleHealthCheck(response);
    return;
  }
  if (request.method === "GET" && request.url === "/api/history") {
    handleGetHistory(response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/history") {
    await handleCreateHistory(request, response);
    return;
  }
  if (request.method === "DELETE" && request.url.startsWith("/api/history/")) {
    await handleDeleteHistory(request, response);
    return;
  }
  lastUserRequestAt = Date.now();
  if (request.method === "POST" && request.url === "/api/tts") {
    await handleTextToSpeech(request, response);
    return;
  }
  if (request.method === "GET" && request.url.startsWith("/api/translate")) {
    await handleTranslation(request, response);
    return;
  }
  if (request.method === "GET") {
    serveFile(request, response);
    return;
  }
  response.writeHead(405);
  response.end("Method not allowed");
};

function startServer(portToTry) {
  const server = createServer(requestHandler);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.warn(
        `Port ${portToTry} đang được sử dụng, chuyển sang port ${portToTry + 1}.`,
      );
      startServer(portToTry + 1);
      return;
    }
    throw error;
  });
  server.listen(portToTry, () => {
    console.log(`French Loop running at http://localhost:${portToTry}`);
    startKeepAlive();
  });
}

startServer(port);
