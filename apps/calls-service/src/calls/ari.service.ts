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
    const client = await this.getClient();
    if (!client) return null;

    const endpoint = await this.resolveEndpoint(phone);
    try {
      const appArgs = [direction, phone, callId, ...extraArgs].join(",");
      // Never use callee as Caller-ID — Zadarma (and most ITSPs) reject it.
      // PJSIP from_user / optional ASTERISK_OUTBOUND_CALLER_ID supply CLI.
      const opts: {
        endpoint: string;
        app: string;
        appArgs: string;
        callerId?: string;
      } = { endpoint, app: this.app, appArgs };
      const cid =
        process.env.ASTERISK_OUTBOUND_CALLER_ID?.trim() ||
        process.env.ZADARMA_CALLER_ID?.trim();
      if (cid) {
        opts.callerId = cid.includes("<") ? cid : `"CRM" <${cid}>`;
      }
      const channel = await client.channels.originate(opts);
      this.log.log(
        `ARI originate ok callId=${callId} channel=${channel.id} endpoint=${endpoint} direction=${direction}`,
      );
      return {
        uniqueId: channel.id,
        channelId: channel.id,
      };
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      this.log.warn(
        `originate failed endpoint=${endpoint}: ${msg}. Check Zadarma SIP password in pjsip + pjsip show registrations`,
      );
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

  private async resolveEndpoint(phone: string): Promise<string> {
    // ASTERISK_OUTBOUND_TRUNK — PJSIP endpoint name (auth / AOR), e.g. trunk-zadarma
    // Avoid ASTERISK_OUTBOUND_ENDPOINT with ${phone} template — PM2/dotenv expands ${phone} to empty.
    const trunk =
      process.env.ASTERISK_OUTBOUND_TRUNK ||
      (await this.resolveDbTrunk()) ||
      "trunk-zadarma";
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      this.log.warn(`resolveEndpoint: no digits in "${phone}", fallback PJSIP literal`);
      return `PJSIP/${phone}@${trunk}`;
    }

    // Same dial string as asterisk/config/extensions.conf [dial-out]:
    //   Dial(PJSIP/sip:${EXTEN}@pbx.zadarma.com)
    // Full SIP URI in Request-URI; auth via pjsip.conf default_outbound_endpoint=trunk-zadarma.
    // Short form PJSIP/<num>@trunk sometimes provokes Anonymous / wrong INVITE on Zadarma.
    const style = (process.env.ASTERISK_OUTBOUND_DIAL_STYLE ?? "sip-uri").toLowerCase();
    if (style === "endpoint" || style === "short" || style === "trunk") {
      return `PJSIP/${digits}@${trunk}`;
    }
    const sipHost =
      process.env.ZADARMA_PBX_HOST?.trim() ||
      process.env.ASTERISK_OUTBOUND_SIP_HOST?.trim() ||
      "pbx.zadarma.com";
    return `PJSIP/sip:${digits}@${sipHost}`;
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
