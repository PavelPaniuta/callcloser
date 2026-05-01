import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as ari from "ari-client";
import type { AriClient } from "ari-client";
import { IntegrationStatus, IntegrationType, prisma } from "@crm/db";

@Injectable()
export class AriService implements OnModuleDestroy {
  private readonly log = new Logger(AriService.name);
  private client: AriClient | null = null;
  private connecting: Promise<AriClient | null> | null = null;

  private get url() {
    return process.env.ASTERISK_ARI_URL ?? "";
  }
  private get user() {
    return process.env.ASTERISK_ARI_USER ?? "crm";
  }
  private get pass() {
    return process.env.ASTERISK_ARI_PASS ?? "";
  }
  private get app() {
    return process.env.ASTERISK_ARI_APP ?? "crm-voice";
  }

  isEnabled() {
    return Boolean(this.url && this.pass);
  }

  async getClient(): Promise<AriClient | null> {
    if (!this.isEnabled()) return null;
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = ari
      .connect(this.url, this.user, this.pass)
      .then((c: AriClient) => {
        this.client = c;
        this.log.log("ARI connected");
        return c;
      })
      .catch((e: unknown) => {
        this.log.warn(`ARI connect failed: ${(e as Error)?.message ?? e}`);
        return null;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async originateOutbound(
    phone: string,
    callId: string,
    direction: string = "outbound",
    extraArgs: string[] = [],
  ): Promise<{ uniqueId?: string; channelId?: string } | null> {
    if (!this.isEnabled()) return null;

    const digits = phone.replace(/\D/g, "");
    const rawCid =
      process.env.ASTERISK_OUTBOUND_CALLER_ID?.trim() ||
      process.env.ZADARMA_CALLER_ID?.trim();
    const callerId = rawCid ? this.normalizeSipCallerId(rawCid) : undefined;

    /** Dialplan Dial() до відповіді, потім Stasis — без фальшивого «Up» до GSM. */
    if (this.useDialplanOriginate() && digits && direction === "outbound") {
      const httpDial = await this.originateOutboundDialplanHttp(digits, callId, callerId);
      if (httpDial) {
        const hangupId = httpDial.name ?? httpDial.id;
        this.log.log(
          `ARI originate ok (dialplan→Stasis) callId=${callId} channel=${httpDial.id} name=${httpDial.name ?? "-"} hangupId=${hangupId} extension=${digits} direction=${direction} callerId=${callerId ?? "default"}`,
        );
        return { uniqueId: httpDial.id, channelId: hangupId };
      }
      /** Прямий PJSIP+Stasis давав Up/Stasis до реального кільця GSM — у CRM «дзвінок», телефон мовчить. */
      this.log.warn(
        `Dialplan originate failed — not using PSTN fallback. Fix ARI/dialplan or set ASTERISK_OUTBOUND_USE_DIALPLAN=false for legacy debug only.`,
      );
      return null;
    }

    const endpoint = await this.resolveEndpoint(phone);
    const appArgs = [direction, phone, callId, ...extraArgs].join(",");

    const http = await this.originateOutboundHttp(endpoint, appArgs, callerId);
    if (http) {
      this.log.log(
        `ARI originate ok callId=${callId} channel=${http.id} endpoint=${endpoint} direction=${direction} callerId=${callerId ?? "default"}`,
      );
      return { uniqueId: http.id, channelId: http.id };
    }

    const client = await this.getClient();
    if (!client) return null;
    try {
      const opts: {
        endpoint: string;
        app: string;
        appArgs: string;
        callerId?: string;
      } = { endpoint, app: this.app, appArgs };
      if (callerId) opts.callerId = callerId;
      const channel = await client.channels.originate(opts);
      this.log.log(
        `ARI originate ok callId=${callId} channel=${channel.id} endpoint=${endpoint} direction=${direction}`,
      );
      return { uniqueId: channel.id, channelId: channel.id };
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      this.log.warn(
        `originate failed endpoint=${endpoint}: ${msg}. Check Zadarma SIP password in pjsip + pjsip show registrations`,
      );
      return null;
    }
  }

  /**
   * Outbound CLI for ARI `callerId`. Leading "+" in .env breaks some loaders (use digits only there).
   * Default: digits only — many ITSPs (Zadarma included) handle this more reliably than `"Name" <n>`.
   * Set ASTERISK_OUTBOUND_CALLER_ID_STYLE=named for `"CRM" <digits>`.
   */
  private normalizeSipCallerId(raw: string): string {
    const t = raw.trim();
    if (t.includes("<") && t.includes(">")) return t;
    const digits = t.replace(/\D/g, "");
    if (!digits) return t;
    const style = (process.env.ASTERISK_OUTBOUND_CALLER_ID_STYLE ?? "digits").toLowerCase();
    if (style === "named" || style === "crm") return `"CRM" <${digits}>`;
    return digits;
  }

  /** default true — див. extensions.conf [crm-ari-outbound] */
  private useDialplanOriginate(): boolean {
    const v = process.env.ASTERISK_OUTBOUND_USE_DIALPLAN;
    if (v === undefined || v.trim() === "") return true;
    return v === "1" || v.toLowerCase() === "true";
  }

  /**
   * ARI без app: канал йде в dialplan → Dial(PJSIP/…) блокує до відповіді абонента → Stasis(...,postdial).
   */
  private async originateOutboundDialplanHttp(
    digits: string,
    callId: string,
    callerId?: string,
  ): Promise<{ id: string; name?: string } | null> {
    const base = this.url.replace(/\/$/, "");
    if (!base) return null;
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString("base64");
    const timeoutSec = Math.min(
      300,
      Math.max(30, Number(process.env.ASTERISK_ARI_ORIGINATE_TIMEOUT_SEC ?? 120) || 120),
    );
    const context =
      process.env.ASTERISK_OUTBOUND_DIALPLAN_CONTEXT?.trim() || "crm-ari-outbound";
    /** Asterisk ARI reads originate parameters from the query string; body supports only `variables`. */
    const params = new URLSearchParams({
      endpoint: `Local/${digits}@${context}`,
      extension: digits,
      context,
      priority: "1",
      timeout: String(timeoutSec),
      formats: "ulaw,alaw",
    });
    /** Unverified CLI in Zadarma can break INVITE; set ASTERISK_ARI_OMIT_CALLER_ID=true to skip. */
    if (
      callerId &&
      process.env.ASTERISK_ARI_OMIT_CALLER_ID !== "1" &&
      process.env.ASTERISK_ARI_OMIT_CALLER_ID?.toLowerCase() !== "true"
    ) {
      params.set("callerId", callerId);
    }
    try {
      const res = await fetch(`${base}/channels?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          variables: {
            CRM_CALL_ID: callId,
            __CRM_CALL_ID: callId,
          },
        }),
      });
      if (!res.ok) {
        this.log.warn(`ARI HTTP originate (dialplan) ${res.status}: ${await res.text()}`);
        return null;
      }
      const j = (await res.json()) as { id?: string; name?: string };
      if (!j.id) return null;
      return { id: j.id, name: j.name };
    } catch (e: unknown) {
      this.log.warn(`ARI HTTP originate (dialplan) error: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  /** Prefer HTTP originate: explicit timeout, same JSON Asterisk documents (ari-client omits timeout). */
  private async originateOutboundHttp(
    endpoint: string,
    appArgs: string,
    callerId?: string,
  ): Promise<{ id: string } | null> {
    const base = this.url.replace(/\/$/, "");
    if (!base) return null;
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString("base64");
    const timeoutSec = Math.min(
      300,
      Math.max(30, Number(process.env.ASTERISK_ARI_ORIGINATE_TIMEOUT_SEC ?? 120) || 120),
    );
    const body: Record<string, unknown> = {
      endpoint,
      app: this.app,
      appArgs,
      timeout: timeoutSec,
    };
    if (callerId) body.callerId = callerId;
    try {
      const res = await fetch(`${base}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.log.warn(`ARI HTTP originate ${res.status}: ${await res.text()}`);
        return null;
      }
      const j = (await res.json()) as { id?: string };
      if (!j.id) return null;
      return { id: j.id };
    } catch (e: unknown) {
      this.log.warn(`ARI HTTP originate error: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  async hangupChannel(channelId: string): Promise<boolean> {
    if (!channelId?.trim()) return false;
    const client = await this.getClient();
    const ids = this.hangupChannelCandidates(channelId.trim());
    for (const id of ids) {
      if (client) {
        try {
          await client.channels.hangup({ channelId: id });
          this.log.log(`ARI hangup ok: ${id}`);
          return true;
        } catch (e: unknown) {
          this.log.warn(`ARI hangup failed ${id}: ${(e as Error)?.message ?? e}`);
        }
      }
      const ok = await this.hangupChannelHttp(id);
      if (ok) return true;
    }
    return false;
  }

  private hangupChannelCandidates(channelId: string): string[] {
    const out: string[] = [channelId];
    if (channelId.includes(";1")) out.push(channelId.replace(";1", ";2"));
    else if (channelId.includes(";2")) out.push(channelId.replace(";2", ";1"));
    else if (channelId.startsWith("Local/")) {
      out.push(`${channelId};1`, `${channelId};2`);
    }
    return [...new Set(out)];
  }

  /** Raw ARI REST — ari-client іноді віддає 404 через формат id; URL-encoding обовʼязковий. */
  private async hangupChannelHttp(channelId: string): Promise<boolean> {
    const base = this.url.replace(/\/$/, "");
    if (!base) return false;
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString("base64");
    try {
      const url = `${base}/channels/${encodeURIComponent(channelId)}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Basic ${auth}` },
      });
      if (res.ok) {
        this.log.log(`ARI HTTP hangup ok: ${channelId}`);
        return true;
      }
      this.log.warn(`ARI HTTP hangup ${res.status}: ${channelId}`);
    } catch (e: unknown) {
      this.log.warn(`ARI HTTP hangup error: ${(e as Error)?.message ?? e}`);
    }
    return false;
  }

  async onModuleDestroy() {
    this.client = null;
  }

  /**
   * Zadarma PBX manual — same dial string as extensions.conf [zadarma-out]:
   * `Dial(PJSIP/${EXTEN}@…)` → ARI `PJSIP/{digits}@{trunk}`.
   * @see https://zadarma.com/en/support/instructions/asteriskpjsip/
   */
  private async resolveEndpoint(phone: string): Promise<string> {
    const trunk =
      process.env.ASTERISK_OUTBOUND_TRUNK ||
      (await this.resolveDbTrunk()) ||
      "trunk-zadarma";
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      this.log.warn(`resolveEndpoint: no digits in "${phone}", fallback PJSIP literal`);
      return `PJSIP/${phone}@${trunk}`;
    }
    return `PJSIP/${digits}@${trunk}`;
  }

  private async resolveDbTrunk(): Promise<string | null> {
    const row = await prisma.sipTrunk.findFirst({
      where: {
        isDefault: true,
        provider: {
          type: IntegrationType.SIP,
          status: IntegrationStatus.ACTIVE,
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return row?.endpointName ?? null;
  }
}
