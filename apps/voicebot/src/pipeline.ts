import OpenAI from "openai";
import { toFile } from "openai";

export interface VoiceContext {
  systemPrompt: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

const PHONE_RULES = `

ВАЖНО — правила телефонного разговора:
- Говори КОРОТКО: максимум 1-2 предложения за раз.
- НЕ используй списки, маркеры, звёздочки, заголовки — только живая речь.
- Задавай один вопрос за раз, жди ответа.
- Будь естественным и дружелюбным, как живой человек.
- Не повторяй то, что уже говорил.`;

function buildMessages(ctx: VoiceContext, userMessage: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const isGreeting = userMessage === "__greeting__";
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: ctx.systemPrompt + PHONE_RULES },
    ...(ctx.history ?? []),
    ...(isGreeting ? [] : [{ role: "user" as const, content: userMessage }]),
  ];
  if (isGreeting) {
    messages.push({ role: "user", content: "Поздоровайся с клиентом одним коротким предложением и представься." });
  }
  return messages;
}

/**
 * Generate assistant reply via OpenAI GPT (non-streaming).
 * Pass "__greeting__" as userMessage to get an opening greeting.
 */
export async function runTurn(
  ctx: VoiceContext,
  userMessage: string,
): Promise<string> {
  const client = getOpenAI();
  const keyPreview = process.env.OPENAI_API_KEY?.slice(0, 20) ?? "MISSING";
  console.log(`[LLM] key="${keyPreview}..." prompt="${ctx.systemPrompt?.slice(0, 60)}" msg="${userMessage?.slice(0, 40)}"`);

  if (client) {
    try {
      const resp = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: buildMessages(ctx, userMessage),
        max_tokens: 80,
        temperature: 0.7,
      });
      return resp.choices[0]?.message?.content?.trim() ?? "Слушаю вас.";
    } catch (e) {
      console.warn(`[LLM] OpenAI error: ${(e as Error)?.message ?? e}`);
    }
  }

  if (userMessage === "__greeting__") return "Здравствуйте! Чем могу помочь вам сегодня?";
  return "Понял вас. Расскажите подробнее, чем могу помочь?";
}

/**
 * Stream GPT response sentence by sentence.
 * Yields each sentence as it arrives so TTS can start immediately.
 */
export async function* runTurnStream(
  ctx: VoiceContext,
  userMessage: string,
): AsyncGenerator<string> {
  const client = getOpenAI();
  if (!client) {
    yield userMessage === "__greeting__"
      ? "Здравствуйте! Чем могу помочь?"
      : "Понял вас.";
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: buildMessages(ctx, userMessage),
      max_tokens: 80,
      temperature: 0.7,
      stream: true,
    });

    let buffer = "";
    for await (const chunk of stream) {
      buffer += chunk.choices[0]?.delta?.content ?? "";
      // Yield at sentence boundaries
      const m = buffer.match(/^(.*?[.!?…]+)\s*([\s\S]*)$/);
      if (m) {
        const sentence = m[1].trim();
        if (sentence) yield sentence;
        buffer = m[2];
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } catch (e) {
    console.warn(`[LLM] stream error: ${(e as Error)?.message ?? e}`);
    yield "Минуту, пожалуйста.";
  }
}

/**
 * Transcribe audio buffer using OpenAI Whisper.
 * audioBuffer: raw WAV/OGG/MP3 bytes, format: file extension like "wav"
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  format: string = "wav",
): Promise<string> {
  const client = getOpenAI();

  if (client) {
    try {
      const file = await toFile(audioBuffer, `audio.${format}`, { type: `audio/${format}` });
      const resp = await client.audio.transcriptions.create({
        file,
        model: "whisper-1",
        language: "ru",
      });
      return resp.text?.trim() ?? "";
    } catch (e) {
      console.warn(`[ASR] Whisper error: ${(e as Error)?.message ?? e}`);
    }
  }

  // Fallback mock
  return "Расскажите подробнее о ваших услугах.";
}

// Keep old exports for compatibility
export const runMockTurn = runTurn;
export const mockTranscribe = (_hint: string) =>
  Promise.resolve("Расскажите подробнее о ваших услугах.");
