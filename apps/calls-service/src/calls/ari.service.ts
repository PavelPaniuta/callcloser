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
      return {
        uniqueId: channel.id,
        channelId: channel.id,
      };
    } catch (e: unknown) {
      this.log.warn(`originate failed: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  async hangupChannel(channelId: string) {
    const client = await this.getClient();
    if (!client) return false;
    try {
      await client.channels.hangup({ channelId });
      return true;
    } catch (e: unknown) {
      this.log.warn(`hangup failed: ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  async onModuleDestroy() {
    this.client = null;
  }

  private async resolveEndpoint(phone: string): Promise<string> {
    const envEndpoint = process.env.ASTERISK_OUTBOUND_ENDPOINT;
    if (envEndpoint?.includes("${phone}")) {
      return envEndpoint.replaceAll("${phone}", phone);
    }
    if (envEndpoint) {
      return envEndpoint;
    }

    const trunk = await prisma.sipTrunk.findFirst({
      where: {
        isDefault: true,
        provider: {
          type: IntegrationType.SIP,
          status: IntegrationStatus.ACTIVE,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!trunk) return `PJSIP/${phone}@trunk`;
    return `PJSIP/${phone}@${trunk.endpointName}`;
  }
}
