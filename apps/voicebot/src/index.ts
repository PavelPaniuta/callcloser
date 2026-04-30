import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
dotenvConfig({ path: resolve(__dirname, "../../../.env"), override: false });

import * as net from "net";
import * as ari from "ari-client";
import type { Channel } from "ari-client";
import { runTurn, runTurnStream, transcribeAudio } from "./pipeline";

// ── Singleton guard via TCP control port ─────────────────────────────────────
// Works on Windows where SIGTERM doesn't trigger Node.js handlers.
// New instance connects to the control port → old instance closes ARI WS → exits.

const CTRL_PORT = 3099;

async function ensureSingleton(onShutdown: () => void): Promise<void> {
  // Signal any running instance to shut down
  await new Promise<void>((resolve) => {
    const sock = net.connect(CTRL_PORT, "127.0.0.1");
    sock.once("connect", () => {
      console.log("[VoiceBot] Signalling previous instance to shutdown...");
      sock.write("shutdown");
      sock.destroy();
      resolve();
    });
    sock.once("error", () => resolve()); // No previous instance running
    setTimeout(resolve, 600);
  });

  // Give old instance time to close its WebSocket
  await new Promise((r) => setTimeout(r, 900));

  // Start control server so future instances can signal US
  const server = net.createServer((sock) => {
    sock.once("data", (d) => {
      if (d.toString().includes("shutdown")) {
        console.log("[VoiceBot] Shutdown requested by new instance");
        try { server.close(); } catch { /* ignore */ }
        onShutdown();
      }
    });
  });
  server.listen(CTRL_PORT, "127.0.0.1", () => {
    console.log(`[VoiceBot] Control port ${CTRL_PORT} ready`);
  });
  // Ignore "address in use" if old server hasn't freed port yet
  server.once("error", () => undefined);
}

const secret = () => process.env.INTERNAL_API_SECRET ?? "dev-internal-secret";
const callsBase = () => process.env.CALLS_SERVICE_URL ?? "http://localhost:3012";
const promptBase = () => process.env.PROMPT_SERVICE_URL ?? "http://localhost:3013";
const ttsBase = () => process.env.TTS_SERVICE_URL ?? "http://localhost:3015";
const ariBase = () => process.env.ASTERISK_ARI_URL ?? "http://localhost:8088/ari";
const ariUser = () => process.env.ASTERISK_ARI_USER ?? "crm";
const ariPass = () => process.env.ASTERISK_ARI_PASS ?? "";

const ANSWER_TIMEOUT_MS = 60_000;
const RECORD_MAX_SEC = 15;
const RECORD_SILENCE_SEC = 1.5;
const MAX_TURNS = 5;

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function fetchActivePrompt() {
  const r = await fetch(`${promptBase()}/prompts/active`);
  if (!r.ok) throw new Error("prompts/active failed");
  return r.json() as Promise<{ id: string; systemPrompt: string }>;
}

async function internalInbound(callerPhone: string, promptVersionId?: string) {
  const r = await post(
    `${callsBase()}/internal/calls/inbound`,
    { callerPhone, promptVersionId },
    { "x-internal-secret": secret() },
  );
  if (!r.ok) throw new Error(`inbound failed: ${await r.text()}`);
  return r.json() as Promise<{ id: string }>;
}

async function patchStatus(callId: string, status: string) {
  await post(
    `${callsBase()}/internal/calls/${callId}/status`,
    { status },
    { "x-internal-secret": secret() },
  );
}

async function finalizeCall(callId: string, opts: { recordingKey?: string; failureReason?: string }) {
  await post(
    `${callsBase()}/internal/calls/${callId}/finalize`,
    opts,
    { "x-internal-secret": secret() },
  );
}

async function sendTranscript(
  callId: string,
  turns: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (turns.length === 0) return;
  const text = turns
    .map((t) => `[${t.role === "assistant" ? "BOT" : "USER"}]: ${t.content}`)
    .join("\n");
  await post(
    `${callsBase()}/internal/calls/${callId}/transcript`,
    { transcript: text },
    { "x-internal-secret": secret() },
  ).catch((e) => console.warn(`[Transcript] send failed: ${(e as Error)?.message ?? e}`));
  console.log(`[Transcript] sent ${turns.length} turns for call=${callId}`);
}

// ── TTS ─────────────────────────────────────────────────────────────────────

interface TtsResult {
  soundUri: string;
  durationMs: number;
}

async function textToSpeech(text: string): Promise<TtsResult | null> {
  try {
    const r = await post(`${ttsBase()}/tts`, { text, lang: "ru" });
    if (!r.ok) return null;
    const d = (await r.json()) as { url?: string; durationMs?: number };
    if (!d.url) return null;
    const filename = d.url.split("/").pop()?.replace(/\.wav$/i, "") ?? "";
    const soundUri = `sound:crm-tts/${filename}`;
    const durationMs = d.durationMs ?? 5000;
    console.log(`[TTS] ${text.slice(0, 60)} → ${soundUri} (${durationMs}ms)`);
    return { soundUri, durationMs };
  } catch (e) {
    console.warn(`[TTS] ${(e as Error)?.message ?? e}`);
    return null;
  }
}

// ── Playback ─────────────────────────────────────────────────────────────────
// Fire play via ARI REST directly, then wait based on estimated audio length.

/** Sends play command to ARI, returns playbackId (or null on error). */
async function startPlayback(channelId: string, mediaUrl: string): Promise<string | null> {
  const auth = `Basic ${Buffer.from(`${ariUser()}:${ariPass()}`).toString("base64")}`;
  try {
    const res = await fetch(`${ariBase()}/channels/${channelId}/play`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: auth },
      body: JSON.stringify({ media: mediaUrl }),
    });
    if (!res.ok) {
      console.warn(`[Play] ARI HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const pb = (await res.json()) as { id?: string };
    console.log(`[Play] started playback=${pb.id} media=${mediaUrl}`);
    return pb.id ?? null;
  } catch (e) {
    console.warn(`[Play] error: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/** Stops a running playback by ID. */
async function stopPlayback(playbackId: string): Promise<void> {
  const auth = `Basic ${Buffer.from(`${ariUser()}:${ariPass()}`).toString("base64")}`;
  await fetch(`${ariBase()}/playbacks/${playbackId}`, {
    method: "DELETE",
    headers: { Authorization: auth },
  }).catch(() => undefined);
}

async function speak(
  client: ari.AriClient,
  channel: Channel,
  text: string,
): Promise<void> {
  const tts = await textToSpeech(text);
  if (!tts) { console.warn("[Speak] no TTS URL"); return; }

  const playStart = Date.now();
  await startPlayback(channel.id, tts.soundUri);

  // Wait for audio to actually finish playing in the handset.
  // Asterisk removes the playback object slightly before audio ends,
  // so we rely on estimated duration + safety buffer.
  const elapsed = Date.now() - playStart;
  const remaining = tts.durationMs - elapsed + 150;
  if (remaining > 0) {
    console.log(`[Speak] waiting ${remaining}ms`);
    await new Promise((r) => setTimeout(r, remaining));
  }
}

// ── Recording + ASR ──────────────────────────────────────────────────────────

function recordSegment(
  client: ari.AriClient,
  channel: Channel,
  name: string,
  silenceSec: number = RECORD_SILENCE_SEC,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn("[Record] timeout");
      resolve(false);
    }, (RECORD_MAX_SEC + 5) * 1000);

    (client as unknown as { on: (e: string, cb: (evt: { recording?: { name?: string; cause?: string; state?: string } }) => void) => void }).on(
      "RecordingFinished",
      (evt) => {
        const rec = evt?.recording;
        if (rec?.name === name) {
          console.log(`[Record] finished name=${name} cause=${rec.cause} state=${rec.state}`);
          clearTimeout(timer);
          resolve(true);
        }
      },
    );

    (client as unknown as { on: (e: string, cb: (evt: { recording?: { name?: string } }) => void) => void }).on(
      "RecordingFailed",
      (evt) => {
        if (evt?.recording?.name === name) {
          clearTimeout(timer);
          console.warn(`[Record] failed: ${name}`);
          resolve(false);
        }
      },
    );

    (channel as unknown as {
      record: (opts: Record<string, unknown>, cb: (err: unknown) => void) => void;
    }).record(
      {
        name,
        format: "wav",
        maxDurationSeconds: RECORD_MAX_SEC,
        maxSilenceSeconds: silenceSec,
        beep: false,
        ifExists: "overwrite",
      },
      (err) => {
        if (err) {
          clearTimeout(timer);
          console.warn(`[Record] start error: ${(err as Error)?.message ?? err}`);
          resolve(false);
        }
      },
    );
  });
}

async function fetchRecording(name: string): Promise<Buffer | null> {
  try {
    const url = `${ariBase()}/recordings/stored/${encodeURIComponent(name)}/file`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${ariUser()}:${ariPass()}`).toString("base64")}`,
      },
    });
    if (!r.ok) { console.warn(`[ASR] fetch recording HTTP ${r.status}`); return null; }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.warn(`[ASR] fetch recording error: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

// ── Answer detection ─────────────────────────────────────────────────────────

function waitForAnswer(client: ari.AriClient, channel: Channel): Promise<boolean> {
  return new Promise((resolve) => {
    const ch = channel as unknown as { state?: string };
    if (ch.state === "Up") { resolve(true); return; }

    const timer = setTimeout(() => {
      client.removeListener("ChannelStateChange", handler as never);
      resolve(false);
    }, ANSWER_TIMEOUT_MS);

    function handler(_: unknown, ch2: Channel) {
      if (ch2.id !== channel.id) return;
      const s = (ch2 as unknown as { state?: string }).state;
      if (s === "Up") {
        clearTimeout(timer);
        client.removeListener("ChannelStateChange", handler as never);
        resolve(true);
      }
    }
    client.on("ChannelStateChange" as never, handler as never);
  });
}

// ── VAPI Bridge helpers ──────────────────────────────────────────────────────
// Coordination: when the VAPI SIP leg enters Stasis, we look up the bridge here
// and immediately add it — no polling needed.
const pendingVapiBridges = new Map<string, string>(); // vapiChannelId → bridgeId

function ariAuth(): string {
  return `Basic ${Buffer.from(`${ariUser()}:${ariPass()}`).toString("base64")}`;
}

async function ariPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${ariBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ariAuth() },
    body: JSON.stringify(body),
  });
}

async function ariDelete(path: string): Promise<void> {
  await fetch(`${ariBase()}${path}`, {
    method: "DELETE",
    headers: { Authorization: ariAuth() },
  }).catch(() => undefined);
}

/**
 * Called when the second (VAPI SIP) leg enters Stasis.
 * Adds it to the bridge that was created by the customer-leg handler.
 */
async function handleVapiBridgeLeg(channel: Channel, bridgeId: string): Promise<void> {
  console.log(`[VAPI-Bridge] SIP leg channel=${channel.id} joining bridge=${bridgeId}`);
  const r = await ariPost(`/bridges/${bridgeId}/addChannel`, { channel: channel.id });
  if (!r.ok) {
    console.warn(`[VAPI-Bridge] addChannel failed: ${r.status} ${await r.text()}`);
  }
  // This handler simply exits — the customer-leg handler owns call lifecycle.
}

/**
 * Full Asterisk-dials + VAPI-AI bridge call flow:
 *  1. Wait for customer to answer via Zadarma SIP trunk.
 *  2. Create an Asterisk mixing bridge.
 *  3. Add the customer channel to the bridge.
 *  4. Originate a second SIP channel to VAPI's gateway (sip.vapi.ai).
 *  5. VAPI SIP leg enters Stasis → handleVapiBridgeLeg adds it to the bridge.
 *  6. Both parties are now bridged; VAPI runs the AI conversation.
 *  7. When either party hangs up, clean up bridge and finalize call record.
 */
async function handleVapiOutbound(
  client: ari.AriClient,
  customerChannel: Channel,
  callId: string,
): Promise<void> {
  console.log(`[VAPI-Bridge] call=${callId} waiting for customer answer...`);

  const answered = await waitForAnswer(client, customerChannel);
  if (!answered) {
    console.log(`[VAPI-Bridge] call=${callId} NO_ANSWER`);
    await customerChannel.hangup().catch(() => undefined);
    await finalizeCall(callId, { failureReason: "NO_ANSWER" });
    return;
  }
  console.log(`[VAPI-Bridge] call=${callId} answered`);
  await patchStatus(callId, "ANSWERED");

  // ── Create mixing bridge ────────────────────────────────────────────────
  const bridgeId = `vapi-bridge-${callId}`;
  const createBridgeRes = await ariPost("/bridges", { type: "mixing", bridgeId });
  if (!createBridgeRes.ok) {
    console.error(`[VAPI-Bridge] bridge create failed: ${createBridgeRes.status}`);
    await finalizeCall(callId, { failureReason: "BRIDGE_CREATE_FAILED" });
    await customerChannel.hangup().catch(() => undefined);
    return;
  }

  // Add customer to bridge
  const addCustRes = await ariPost(`/bridges/${bridgeId}/addChannel`, { channel: customerChannel.id });
  if (!addCustRes.ok) {
    console.error(`[VAPI-Bridge] addChannel(customer) failed: ${addCustRes.status}`);
    await ariDelete(`/bridges/${bridgeId}`);
    await finalizeCall(callId, { failureReason: "BRIDGE_CUSTOMER_ADD_FAILED" });
    await customerChannel.hangup().catch(() => undefined);
    return;
  }

  // ── Originate VAPI SIP leg ──────────────────────────────────────────────
  // VAPI's SIP gateway: PJSIP/{publicKey}@trunk-vapi
  // The public key identifies your VAPI account; VAPI uses the configured assistant.
  const vapiPublicKey = process.env.VAPI_PUBLIC_KEY ?? process.env.VAPI_ASSISTANT_ID ?? "";
  if (!vapiPublicKey) {
    console.error("[VAPI-Bridge] VAPI_PUBLIC_KEY not set in environment");
    await ariDelete(`/bridges/${bridgeId}`);
    await finalizeCall(callId, { failureReason: "VAPI_NOT_CONFIGURED" });
    await customerChannel.hangup().catch(() => undefined);
    return;
  }

  const vapiChanId = `vapi-leg-${callId}`;
  pendingVapiBridges.set(vapiChanId, bridgeId);

  const appName = process.env.ASTERISK_ARI_APP ?? "crm-voice";
  const origRes = await ariPost(`/channels/${vapiChanId}`, {
    endpoint: `PJSIP/${vapiPublicKey}@trunk-vapi`,
    app: appName,
    appArgs: `vapi-bridge-leg,${bridgeId}`,
    callerId: `"AI Assistant" <crm-bridge>`,
  });

  if (!origRes.ok) {
    const errText = await origRes.text();
    console.error(`[VAPI-Bridge] VAPI SIP originate failed ${origRes.status}: ${errText}`);
    pendingVapiBridges.delete(vapiChanId);
    await ariDelete(`/bridges/${bridgeId}`);
    await finalizeCall(callId, { failureReason: `VAPI_ORIGINATE_FAILED: ${origRes.status}` });
    await customerChannel.hangup().catch(() => undefined);
    return;
  }

  console.log(`[VAPI-Bridge] call=${callId} VAPI SIP channel=${vapiChanId} originated, bridging...`);

  // ── Wait for either side to hang up ────────────────────────────────────
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = (reason: string) => {
      if (!resolved) {
        resolved = true;
        console.log(`[VAPI-Bridge] call=${callId} ended: ${reason}`);
        resolve();
      }
    };

    customerChannel.once("StasisEnd" as never, () => done("customer_hangup"));

    const vapiEndHandler = (_: unknown, ch: Channel) => {
      if (ch.id === vapiChanId) {
        client.removeListener("StasisEnd" as never, vapiEndHandler as never);
        done("vapi_hangup");
      }
    };
    client.on("StasisEnd" as never, vapiEndHandler as never);

    // Safety timeout: 45 minutes
    setTimeout(() => done("timeout"), 45 * 60 * 1000);
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────
  pendingVapiBridges.delete(vapiChanId);
  await ariDelete(`/bridges/${bridgeId}`);
  await ariDelete(`/channels/${vapiChanId}`);
  await customerChannel.hangup().catch(() => undefined);
  await finalizeCall(callId, {});
  console.log(`[VAPI-Bridge] call=${callId} done`);
}

// ── Main call handler ─────────────────────────────────────────────────────────

async function handleStasis(client: ari.AriClient, channel: Channel, args: string[]) {
  const direction = args[0] ?? "unknown";
  const arg1 = args[1] ?? "";      // phone (outbound) OR bridgeId (vapi-bridge-leg)
  const arg2 = args[2] ?? "";      // callId (outbound)

  // ── VAPI bridge leg: second channel (to VAPI SIP) entered Stasis ────────
  if (direction === "vapi-bridge-leg") {
    const bridgeId = arg1; // arg1 is bridgeId for this direction
    await handleVapiBridgeLeg(channel, bridgeId);
    return;
  }

  // ── VAPI outbound: Asterisk dialled customer, bridge to VAPI AI ─────────
  if (direction === "outbound-vapi") {
    const callId = arg2;
    if (!callId) {
      console.error("[VAPI-Bridge] outbound-vapi missing callId");
      await channel.hangup().catch(() => undefined);
      return;
    }
    await handleVapiOutbound(client, channel, callId);
    return;
  }

  // ── Regular pipeline (inbound or asterisk-engine outbound) ──────────────
  const phone = arg1;
  const outboundCallId = arg2;

  const prompt = await fetchActivePrompt().catch(() => null);
  if (!prompt) {
    console.error("[VoiceBot] No active prompt");
    await channel.hangup().catch(() => undefined);
    return;
  }

  let callId: string;

  if (direction === "inbound") {
    const row = await internalInbound(phone, prompt.id);
    callId = row.id;
    await channel.answer().catch(() => undefined);
  } else {
    callId = outboundCallId;
    if (!callId) {
      console.error("[VoiceBot] outbound missing callId");
      await channel.hangup().catch(() => undefined);
      return;
    }
    console.log(`[VoiceBot] call=${callId} waiting for answer...`);
    const answered = await waitForAnswer(client, channel);
    if (!answered) {
      console.log(`[VoiceBot] call=${callId} NO_ANSWER`);
      await channel.hangup().catch(() => undefined);
      await finalizeCall(callId, { failureReason: "NO_ANSWER" });
      return;
    }
    console.log(`[VoiceBot] call=${callId} answered`);
  }

  await patchStatus(callId, "ANSWERED");

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let turnCount = 0;
  let hangupDetected = false;

  // Detect if caller hung up
  channel.once("StasisEnd" as never, () => { hangupDetected = true; });

  // ── Greeting ────────────────────────────────────────────────────────────
  const greeting = await runTurn({ systemPrompt: prompt.systemPrompt, history }, "__greeting__");
  console.log(`[VoiceBot] call=${callId} greeting: ${greeting}`);
  history.push({ role: "assistant", content: greeting });
  await speak(client, channel, greeting);

  // ── Conversation loop ────────────────────────────────────────────────────
  while (!hangupDetected && turnCount < MAX_TURNS) {
    turnCount++;

    const recName = `crm-${callId}-t${turnCount}`;
    console.log(`[VoiceBot] call=${callId} listening (turn ${turnCount})...`);
    const recorded = await recordSegment(client, channel, recName);

    if (!recorded || hangupDetected) break;

    const audioBuf = await fetchRecording(recName);
    let userText = "";
    if (audioBuf) {
      userText = await transcribeAudio(audioBuf, "wav");
      console.log(`[VoiceBot] call=${callId} user: "${userText}"`);
    }

    if (!userText) {
      await speak(client, channel, "Простите, не расслышал. Повторите, пожалуйста.");
      continue;
    }

    history.push({ role: "user", content: userText });

    // Stream GPT response sentence by sentence — TTS starts on first sentence,
    // no need to wait for the full reply before speaking.
    let fullReply = "";
    for await (const sentence of runTurnStream({ systemPrompt: prompt.systemPrompt, history }, userText)) {
      console.log(`[VoiceBot] call=${callId} bot sentence: "${sentence}"`);
      fullReply += (fullReply ? " " : "") + sentence;
      await speak(client, channel, sentence);
      if (hangupDetected) break;
    }
    if (fullReply) history.push({ role: "assistant", content: fullReply });

    if (hangupDetected) break;
  }

  if (!hangupDetected) {
    await channel.hangup().catch(() => undefined);
  }

  // Send full conversation transcript to calls-service before finalizing
  await sendTranscript(callId, history);
  await finalizeCall(callId, { recordingKey: `voicebot/${callId}.json` });
  console.log(`[VoiceBot] call=${callId} done (${turnCount} turns)`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const url = ariBase();
  const user = ariUser();
  const pass = ariPass();
  const appName = process.env.ASTERISK_ARI_APP ?? "crm-voice";

  if (!url || !pass) {
    console.warn("VoiceBot: ASTERISK_ARI_URL / ASTERISK_ARI_PASS not set; idle.");
    setInterval(() => undefined, 60_000);
    return;
  }

  // Singleton guard is for local dev (e.g. Windows): second `node dist/index.js`
  // kills the first. Under PM2 there must be only one process — the guard can
  // race with restarts and drop the ARI WebSocket. Disable on VPS:
  //   VOICEBOT_DISABLE_SINGLETON=1 (set in ecosystem.config.js for voicebot)
  const singletonDisabled =
    process.env.VOICEBOT_DISABLE_SINGLETON === "1" ||
    process.env.VOICEBOT_DISABLE_SINGLETON === "true";
  if (!singletonDisabled) {
    await ensureSingleton(() => {
      console.log("[VoiceBot] Shutdown by new instance");
      process.exit(0);
    });
  } else {
    console.log("[VoiceBot] Singleton guard disabled (VOICEBOT_DISABLE_SINGLETON)");
  }

  // Auto-reconnect loop: reconnects after Asterisk restarts or connection drops.
  while (true) {
    try {
      const client = await ari.connect(url, user, pass);
      client.start(appName);
      console.log(`VoiceBot listening Stasis app=${appName}`);

      client.on("StasisStart", (event: { args?: string[] }, channel: ari.Channel) => {
        console.log(`[VoiceBot] StasisStart channel=${channel.id} args=${JSON.stringify(event.args)}`);
        void handleStasis(client, channel, event.args ?? []);
      });

      client.on("StasisEnd", (_event: unknown, channel: ari.Channel) => {
        console.log(`[VoiceBot] StasisEnd channel=${channel.id}`);
      });

      // Block until the ARI connection drops
      await new Promise<void>((_resolve, reject) => {
        const c = client as unknown as {
          on: (e: string, cb: (err?: unknown) => void) => void;
          ws?: { on: (e: string, cb: () => void) => void };
        };
        c.on("error", (err) => reject(err ?? new Error("ARI error")));
        // ws may not exist immediately after connect; attach close when ready
        let attachAttempts = 0;
        const attachWsClose = () => {
          if (c.ws?.on) {
            c.ws.on("close", () => reject(new Error("ARI WebSocket closed")));
            return;
          }
          if (++attachAttempts > 50) {
            console.warn("[VoiceBot] ARI internal WebSocket not exposed; only 'error' will trigger reconnect");
            return;
          }
          setTimeout(attachWsClose, 100);
        };
        setImmediate(attachWsClose);
      });
    } catch (err) {
      console.warn(`[VoiceBot] ARI disconnected: ${(err as Error).message}. Reconnecting in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
