import { createReadStream } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import "dotenv/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = "JBFqnCBsd6RMkjVDRZzb";
const modelId = "eleven_v3";

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
  if (request.method === "POST" && request.url === "/api/tts") {
    await handleTextToSpeech(request, response);
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
  });
}

startServer(port);
