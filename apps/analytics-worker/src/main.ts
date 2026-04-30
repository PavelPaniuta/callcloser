import { Worker } from "bullmq";
import { prisma } from "@crm/db";
import OpenAI from "openai";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAI({ apiKey: key }) : null;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.warn("[Analytics] Telegram error:", (e as Error).message);
  }
}

// ── Stop word config ──────────────────────────────────────────────────────────

type StopWordRule = {
  word: string;
  action: "DNC" | "TAG" | "NOTIFY";
  tag?: string;
};

async function loadStopWords(): Promise<StopWordRule[]> {
  const cfg = await prisma.systemConfig.findUnique({
    where: { key: "analytics.stopWords" },
  });
  if (!cfg) return [];
  const val = cfg.value as StopWordRule[] | null;
  return Array.isArray(val) ? val : [];
}

// ── LLM analysis ──────────────────────────────────────────────────────────────

async function runLlmReport(transcript: string): Promise<{ summary: string; improvements: string }> {
  const ai = getOpenAI();
  if (!ai) {
    return {
      summary: "Кратко: обсудили запрос клиента, договорились о следующих шагах.",
      improvements: "Короче формулировать вопросы; в конце явно резюмировать договорённости.",
    };
  }
  try {
    const resp = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Ты QA-аналитик колл-центра. Получишь транскрипт звонка. " +
            "Ответь строго JSON с полями: " +
            "summary (1-2 предложения — итог звонка), " +
            "improvements (1-2 предложения — что улучшить боту). " +
            "Только JSON, без markdown.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw) as { summary?: string; improvements?: string };
    return {
      summary: parsed.summary ?? "Анализ недоступен",
      improvements: parsed.improvements ?? "",
    };
  } catch (e) {
    console.warn("[Analytics] LLM error:", (e as Error).message);
    return { summary: "Ошибка анализа", improvements: "" };
  }
}

// ── Stop word detection ───────────────────────────────────────────────────────

function detectStopWords(
  transcript: string,
  rules: StopWordRule[],
): Array<{ word: string; action: string; count: number }> {
  const lower = transcript.toLowerCase();
  const hits: Array<{ word: string; action: string; count: number }> = [];
  for (const rule of rules) {
    const w = rule.word.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(w, idx)) !== -1) { count++; idx += w.length; }
    if (count > 0) hits.push({ word: rule.word, action: rule.action, count });
  }
  return hits;
}

// ── Actions + Telegram on stop words ─────────────────────────────────────────

async function applyStopWordActions(
  callId: string,
  contactId: string | null,
  contactName: string | null,
  contactPhone: string | null,
  transcript: string,
  rules: StopWordRule[],
) {
  const hits = detectStopWords(transcript, rules);
  if (hits.length === 0) return hits;

  console.log(`[Analytics] call=${callId} detected keywords:`, hits.map((h) => h.word));

  for (const hit of hits) {
    const rule = rules.find((r) => r.word.toLowerCase() === hit.word.toLowerCase());
    if (!rule) continue;

    if (rule.action === "DNC" && contactId) {
      const dncCfg = await prisma.systemConfig.findUnique({ where: { key: "campaign.dnc" } });
      const dncList = (dncCfg?.value as string[] | null) ?? [];
      if (contactPhone && !dncList.includes(contactPhone)) {
        await prisma.systemConfig.upsert({
          where: { key: "campaign.dnc" },
          create: { key: "campaign.dnc", value: [...dncList, contactPhone] },
          update: { value: [...dncList, contactPhone] },
        });
      }
    }

    if ((rule.action === "TAG" || rule.action === "NOTIFY") && contactId) {
      await prisma.activity.create({
        data: {
          contactId,
          type: rule.action === "TAG" ? `tag:${rule.tag ?? hit.word}` : "notify:stop_word",
          metadata: { callId, word: hit.word, action: rule.action },
        },
      });
    }
  }

  // ── Telegram notification ─────────────────────────────────────────────────
  const wordList = hits.map((h) => `<b>${h.word}</b> (×${h.count})`).join(", ");
  const clientInfo = contactName
    ? `${contactName} | ${contactPhone ?? "?"}`
    : (contactPhone ?? "Неизвестно");

  const snippet = transcript.slice(0, 300).replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const msg =
    `🚨 <b>Стоп-слово обнаружено!</b>\n\n` +
    `👤 Клиент: ${clientInfo}\n` +
    `🔑 Слова: ${wordList}\n` +
    `📋 Транскрипт:\n<i>${snippet}${transcript.length > 300 ? "..." : ""}</i>`;

  await sendTelegram(msg);

  return hits;
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processCall(callId: string) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { contact: true, promptVersion: true, analytics: true },
  });
  if (!call) return;

  const transcript = call.analytics?.transcript ?? [
    `Звонок ${call.id} (${call.direction})`,
    call.contact ? `Контакт: ${call.contact.name ?? ""} ${call.contact.phone}` : "Контакт неизвестен",
    `Промпт: ${call.promptVersion?.name ?? "default"}`,
    "Транскрипт недоступен.",
  ].join("\n");

  const stopWords = await loadStopWords();
  const [report, detectedKeywords] = await Promise.all([
    runLlmReport(transcript),
    applyStopWordActions(
      callId,
      call.contactId ?? null,
      call.contact?.name ?? null,
      call.contact?.phone ?? null,
      transcript,
      stopWords,
    ),
  ]);

  const hasHits = detectedKeywords.length > 0;

  await prisma.callAnalytics.upsert({
    where: { callId: call.id },
    create: {
      callId: call.id,
      transcript: call.analytics?.transcript ?? transcript,
      summary: report.summary,
      improvements: report.improvements,
      detectedKeywords: hasHits ? detectedKeywords : undefined,
      reviewStatus: hasHits ? "PENDING_REVIEW" : undefined,
      telegramSent: hasHits,
    },
    update: {
      summary: report.summary,
      improvements: report.improvements,
      detectedKeywords: hasHits ? detectedKeywords : undefined,
      reviewStatus: hasHits ? "PENDING_REVIEW" : undefined,
      telegramSent: hasHits,
    },
  });

  await prisma.usageRecord.create({
    data: {
      service: "analytics",
      metric: "call_analyzed",
      quantity: 1,
      unit: "count",
      metadata: { callId: call.id },
    },
  });

  console.log(`[Analytics] call=${callId} done. keywords=${detectedKeywords.length}`);
}

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(
  "call-ended",
  async (job) => {
    const callId = job.data.callId as string;
    await processCall(callId);
  },
  { connection: { url: redisUrl } },
);

worker.on("completed", (job) => console.log(`analytics done ${job.id}`));
worker.on("failed", (job, err) => console.error(`analytics failed ${job?.id}`, err));

console.log("Analytics worker listening on queue call-ended");
