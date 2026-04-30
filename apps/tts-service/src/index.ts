import express from "express";
import { mkdirSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import OpenAI from "openai";

ffmpeg.setFfmpegPath(ffmpegPath.path);

const AUDIO_DIR = join(process.cwd(), "tmp-audio");
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

const PORT = process.env.TTS_PORT ? Number(process.env.TTS_PORT) : 3015;
const PUBLIC_HOST =
  process.env.TTS_PUBLIC_HOST ?? "http://host.docker.internal:" + PORT;

const TTS_VOICE = (process.env.OPENAI_TTS_VOICE ?? "nova") as
  | "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ── In-memory TTS cache ───────────────────────────────────────────────────────
// Identical phrases (greetings, "не расслышал", etc.) are generated once
// and reused — saves OpenAI TTS API calls under high concurrency.
const ttsCache = new Map<string, { url: string; durationMs: number }>();
// Deduplicate in-flight requests: same text → share one OpenAI call
const inFlight = new Map<string, Promise<{ url: string; durationMs: number }>>();

const app = express();
app.use(express.json());
app.use("/audio", express.static(AUDIO_DIR));

async function generateTts(text: string): Promise<{ url: string; durationMs: number }> {
  // Return cached result for identical text
  const cached = ttsCache.get(text);
  if (cached) return cached;

  // Deduplicate concurrent requests for the same text
  const existing = inFlight.get(text);
  if (existing) return existing;

  const openai = getOpenAI();
  if (!openai) throw new Error("OPENAI_API_KEY not set");

  const promise = (async () => {
    const speechResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: TTS_VOICE,
      input: text,
      response_format: "mp3",
      speed: 1.0,
    });

    const id = uuidv4();
    const mp3Path = join(AUDIO_DIR, `${id}.mp3`);
    const wavPath = join(AUDIO_DIR, `${id}.wav`);

    const mp3Buf = Buffer.from(await speechResponse.arrayBuffer());
    await writeFile(mp3Path, mp3Buf);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioFrequency(8000)
        .audioChannels(1)
        .audioCodec("pcm_s16le")
        .format("wav")
        .output(wavPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const { unlink, stat } = await import("fs/promises");
    await unlink(mp3Path).catch(() => undefined);
    const wavStats = await stat(wavPath);
    const durationMs = Math.ceil((wavStats.size - 44) / 16_000 * 1000);

    const url = `${PUBLIC_HOST}/audio/${id}.wav`;
    console.log(`[TTS] "${text.slice(0, 60)}" → ${id}.wav (${durationMs}ms)`);

    const result = { url, durationMs };
    // Cache short/common phrases indefinitely; longer ones for 10 min
    if (text.length < 120) ttsCache.set(text, result);
    inFlight.delete(text);
    return result;
  })();

  inFlight.set(text, promise);
  promise.catch(() => inFlight.delete(text));
  return promise;
}

app.post("/tts", async (req, res) => {
  const text: string = req.body?.text ?? "Здравствуйте";

  if (!getOpenAI()) {
    res.status(503).json({ error: "OPENAI_API_KEY not set" });
    return;
  }

  try {
    const result = await generateTts(text);
    res.json(result);
  } catch (err) {
    console.error("[TTS] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`TTS service (OpenAI voice=${TTS_VOICE}) → http://localhost:${PORT}`);
});
