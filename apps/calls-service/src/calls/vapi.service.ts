import { Injectable, Logger } from "@nestjs/common";
import { prisma, IntegrationType, IntegrationStatus } from "@crm/db";

export interface VapiCallResult {
  callId: string;
  status: string;
}

@Injectable()
export class VapiService {
  private readonly log = new Logger(VapiService.name);
  private readonly baseUrl = "https://api.vapi.ai";

  // apiKey + phoneNumberId are required; assistantId is optional (used as fallback
  // when no system prompt is passed — i.e. when the assistant is pre-built in VAPI dashboard)
  private async loadConfig(): Promise<{
    apiKey: string;
    assistantId?: string;
    phoneNumberId: string;
  } | null> {
    const envKey = process.env.VAPI_API_KEY;
    const envPhone = process.env.VAPI_PHONE_NUMBER_ID;

    if (envKey && envPhone) {
      return {
        apiKey: envKey,
        assistantId: process.env.VAPI_ASSISTANT_ID || undefined,
        phoneNumberId: envPhone,
      };
    }

    const integration = await prisma.integrationProvider.findFirst({
      where: { type: IntegrationType.VAPI, status: IntegrationStatus.ACTIVE },
      include: { secrets: true },
    });
    if (!integration) return null;

    const apiKey = integration.secrets.find(
      (s: { keyName: string; cipherText: string }) => s.keyName === "apiKey",
    )?.cipherText;
    const cfg = integration.config as Record<string, string> | null;
    const phoneNumberId = cfg?.phoneNumberId ?? process.env.VAPI_PHONE_NUMBER_ID ?? "";

    if (!apiKey || !phoneNumberId) return null;

    return {
      apiKey,
      assistantId: cfg?.assistantId || process.env.VAPI_ASSISTANT_ID || undefined,
      phoneNumberId,
    };
  }

  isConfigured(): Promise<boolean> {
    return this.loadConfig().then((c) => c !== null);
  }

  /** Normalize to E.164 (+XXXXXXXXXXX). Ukrainian 0XX → +380XX */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    // Ukraine: starts with 0 and 10 digits → add +38
    if (digits.startsWith("0") && digits.length === 10) return `+38${digits}`;
    // Already has country code (38...) → add +
    if (digits.startsWith("38") && digits.length === 12) return `+${digits}`;
    // Already E.164 without +
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return phone; // fallback: return as-is
  }

  async originateCall(
    phone: string,
    callId: string,
    options?: {
      metadata?: Record<string, string>;
      systemPrompt?: string;
      firstMessage?: string;
    },
  ): Promise<VapiCallResult | null> {
    const cfg = await this.loadConfig();
    if (!cfg) {
      this.log.warn("VAPI not configured (missing VAPI_API_KEY or VAPI_PHONE_NUMBER_ID)");
      return null;
    }

    // ── Build assistant payload ────────────────────────────────────────────
    // Priority:
    //  1. systemPrompt provided → full inline assistant (no dashboard setup needed)
    //  2. assistantId configured → use pre-built VAPI dashboard assistant
    //  3. neither → error
    let assistantPayload: Record<string, unknown>;

    if (options?.systemPrompt) {
      // Inline assistant: everything comes from CRM, nothing needs to be
      // pre-configured in VAPI dashboard (except the phone number/SIP trunk)
      assistantPayload = {
        assistant: {
          model: {
            provider: process.env.VAPI_MODEL_PROVIDER ?? "openai",
            model: process.env.VAPI_MODEL_NAME ?? "gpt-4o-mini",
            messages: [{ role: "system", content: options.systemPrompt }],
          },
          voice: {
            provider: process.env.VAPI_VOICE_PROVIDER ?? "openai",
            voiceId: process.env.VAPI_VOICE_ID ?? "nova",
          },
          ...(options.firstMessage ? { firstMessage: options.firstMessage } : {}),
        },
      };
      this.log.log(`VAPI inline assistant (prompt ${options.systemPrompt.length} chars)`);
    } else if (cfg.assistantId) {
      assistantPayload = { assistantId: cfg.assistantId };
      this.log.log(`VAPI dashboard assistant: ${cfg.assistantId}`);
    } else {
      this.log.warn("VAPI: no systemPrompt and no VAPI_ASSISTANT_ID — cannot originate");
      return null;
    }

    const normalizedPhone = this.normalizePhone(phone);
    this.log.log(`Phone: ${phone} → ${normalizedPhone}`);

    const body = {
      ...assistantPayload,
      phoneNumberId: cfg.phoneNumberId,
      customer: {
        number: normalizedPhone,
        numberE164CheckEnabled: false,
      },
      ...(options?.metadata ? { metadata: options.metadata } : {}),
    };

    this.log.log(`VAPI originate → ${phone}`);

    const res = await fetch(`${this.baseUrl}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.log.warn(`VAPI originate failed ${res.status}: ${text}`);
      return null;
    }

    const data = (await res.json()) as { id: string; status: string };
    this.log.log(`VAPI call created: ${data.id} status=${data.status}`);
    return { callId: data.id, status: data.status };
  }

  async testConnection(): Promise<{ ok: boolean; details: string }> {
    const cfg = await this.loadConfig();
    if (!cfg) return { ok: false, details: "VAPI not configured (check VAPI_API_KEY, VAPI_PHONE_NUMBER_ID)" };

    try {
      // Test by listing phone numbers — works without assistantId
      const res = await fetch(`${this.baseUrl}/phone-number/${cfg.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { name?: string; number?: string };
        const label = data.name ?? data.number ?? cfg.phoneNumberId;
        const assistantInfo = cfg.assistantId ? ` | assistant: ${cfg.assistantId}` : " | inline mode";
        return { ok: true, details: `Phone: ${label}${assistantInfo}` };
      }
      return { ok: false, details: `HTTP ${res.status}: ${await res.text()}` };
    } catch (e) {
      return { ok: false, details: (e as Error)?.message ?? String(e) };
    }
  }
}
