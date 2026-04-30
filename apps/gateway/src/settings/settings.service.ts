import { Injectable } from "@nestjs/common";
import {
  ConfigRevisionStatus,
  IntegrationStatus,
  IntegrationType,
  Prisma,
  RoutingAction,
  RoutingDirection,
  prisma,
} from "@crm/db";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";

export interface ProviderUpsertInput {
  name: string;
  type: IntegrationType;
  endpointUrl?: string;
  config?: Record<string, unknown>;
  secret?: string;
}

export interface SipTrunkUpsertInput {
  providerId: string;
  endpointName: string;
  host: string;
  port?: number;
  username?: string;
  fromDomain?: string;
  outboundProxy?: string;
  didNumbers?: string[];
  codecs?: string[];
  transport?: string;
  isDefault?: boolean;
}

export interface RoutingRuleInput {
  direction: RoutingDirection;
  matchExpr: string;
  action: RoutingAction;
  target: string;
  priority?: number;
  enabled?: boolean;
  description?: string;
}

@Injectable()
export class SettingsService {
  private readonly key = createHash("sha256")
    .update(process.env.CONFIG_MASTER_KEY ?? process.env.JWT_SECRET ?? "dev-master-key")
    .digest();

  private encrypt(value: string): { cipherText: string; iv: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([encrypted, tag]).toString("base64");
    return { cipherText: out, iv: iv.toString("base64") };
  }

  private decrypt(cipherText: string, ivB64: string): string {
    const payload = Buffer.from(cipherText, "base64");
    const tag = payload.subarray(payload.length - 16);
    const encrypted = payload.subarray(0, payload.length - 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
  }

  private maskSecret(secret: string): string {
    if (secret.length < 6) return "******";
    return `${secret.slice(0, 3)}***${secret.slice(-2)}`;
  }

  private toNullableJson(
    value: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    if (value === undefined || value === null) return {} as Prisma.InputJsonValue;
    return value as Prisma.InputJsonValue;
  }

  async listProviders() {
    const rows = await prisma.integrationProvider.findMany({
      include: { secrets: true, sipTrunks: true },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => ({
      ...row,
      secrets: row.secrets.map((s) => ({
        keyName: s.keyName,
        version: s.version,
        maskedValue: this.maskSecret(this.decrypt(s.cipherText, s.iv)),
        updatedAt: s.updatedAt,
      })),
    }));
  }

  async createProvider(input: ProviderUpsertInput) {
    const row = await prisma.integrationProvider.create({
      data: {
        name: input.name,
        type: input.type,
        endpointUrl: input.endpointUrl,
        config: this.toNullableJson(input.config),
      },
    });

    if (input.secret) {
      const enc = this.encrypt(input.secret);
      await prisma.integrationSecret.create({
        data: {
          providerId: row.id,
          keyName: "apiKey",
          cipherText: enc.cipherText,
          iv: enc.iv,
        },
      });
    }

    return this.getProvider(row.id);
  }

  async updateProvider(id: string, input: Partial<ProviderUpsertInput>) {
    await prisma.integrationProvider.update({
      where: { id },
      data: {
        name: input.name,
        endpointUrl: input.endpointUrl,
        config: this.toNullableJson(input.config),
      },
    });

    if (input.secret !== undefined) {
      const enc = this.encrypt(input.secret);
      const existing = await prisma.integrationSecret.findFirst({
        where: { providerId: id, keyName: "apiKey" },
      });
      if (existing) {
        await prisma.integrationSecret.update({
          where: { id: existing.id },
          data: {
            cipherText: enc.cipherText,
            iv: enc.iv,
            version: { increment: 1 },
          },
        });
      } else {
        await prisma.integrationSecret.create({
          data: {
            providerId: id,
            keyName: "apiKey",
            cipherText: enc.cipherText,
            iv: enc.iv,
          },
        });
      }
    }

    return this.getProvider(id);
  }

  async deleteProvider(id: string) {
    await prisma.integrationProvider.delete({ where: { id } });
    return { ok: true };
  }

  async activateProvider(id: string) {
    const provider = await prisma.integrationProvider.findUniqueOrThrow({ where: { id } });
    await prisma.integrationProvider.updateMany({
      where: { type: provider.type },
      data: { status: IntegrationStatus.INACTIVE },
    });
    await prisma.integrationProvider.update({
      where: { id },
      data: { status: IntegrationStatus.ACTIVE },
    });
    return this.getProvider(id);
  }

  async testProvider(id: string) {
    const provider = await prisma.integrationProvider.findUnique({
      where: { id },
      include: { sipTrunks: true },
    });
    if (!provider) return { ok: false, details: "Provider not found" };

    if (provider.type === IntegrationType.SIP) {
      if (provider.sipTrunks.length === 0) {
        return { ok: false, details: "No SIP trunks configured" };
      }
      const t = provider.sipTrunks[0];
      return {
        ok: Boolean(t.host && t.endpointName),
        details: `SIP trunk ${t.endpointName} host=${t.host}:${t.port}`,
      };
    }

    if (!provider.endpointUrl) {
      return { ok: false, details: "endpointUrl is required" };
    }

    try {
      const res = await fetch(provider.endpointUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, status: res.status, details: "HTTP check completed" };
    } catch (e) {
      return { ok: false, details: (e as Error).message };
    }
  }

  async getProvider(id: string) {
    const row = await prisma.integrationProvider.findUnique({
      where: { id },
      include: { secrets: true, sipTrunks: true },
    });
    if (!row) return null;
    return {
      ...row,
      secrets: row.secrets.map((s) => ({
        keyName: s.keyName,
        version: s.version,
        maskedValue: this.maskSecret(this.decrypt(s.cipherText, s.iv)),
      })),
    };
  }

  async listSipTrunks() {
    return prisma.sipTrunk.findMany({
      include: { provider: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  async upsertSipTrunk(input: SipTrunkUpsertInput & { id?: string }) {
    if (input.isDefault) {
      await prisma.sipTrunk.updateMany({
        where: { providerId: input.providerId },
        data: { isDefault: false },
      });
    }

    if (input.id) {
      return prisma.sipTrunk.update({
        where: { id: input.id },
        data: {
          endpointName: input.endpointName,
          host: input.host,
          port: input.port ?? 5060,
          username: input.username,
          fromDomain: input.fromDomain,
          outboundProxy: input.outboundProxy,
          didNumbers: input.didNumbers ?? [],
          codecs: input.codecs ?? ["alaw", "ulaw"],
          transport: input.transport ?? "udp",
          isDefault: input.isDefault ?? false,
        },
      });
    }

    return prisma.sipTrunk.create({
      data: {
        providerId: input.providerId,
        endpointName: input.endpointName,
        host: input.host,
        port: input.port ?? 5060,
        username: input.username,
        fromDomain: input.fromDomain,
        outboundProxy: input.outboundProxy,
        didNumbers: input.didNumbers ?? [],
        codecs: input.codecs ?? ["alaw", "ulaw"],
        transport: input.transport ?? "udp",
        isDefault: input.isDefault ?? false,
      },
    });
  }

  async deleteSipTrunk(id: string) {
    await prisma.sipTrunk.delete({ where: { id } });
    return { ok: true };
  }

  async listRoutingRules() {
    return prisma.routingRule.findMany({
      orderBy: [{ direction: "asc" }, { priority: "asc" }],
    });
  }

  async createRoutingRule(input: RoutingRuleInput) {
    return prisma.routingRule.create({
      data: {
        direction: input.direction,
        matchExpr: input.matchExpr,
        action: input.action,
        target: input.target,
        priority: input.priority ?? 100,
        enabled: input.enabled ?? true,
        description: input.description,
      },
    });
  }

  async updateRoutingRule(id: string, input: Partial<RoutingRuleInput>) {
    return prisma.routingRule.update({
      where: { id },
      data: {
        direction: input.direction,
        matchExpr: input.matchExpr,
        action: input.action,
        target: input.target,
        priority: input.priority,
        enabled: input.enabled,
        description: input.description,
      },
    });
  }

  async deleteRoutingRule(id: string) {
    await prisma.routingRule.delete({ where: { id } });
    return { ok: true };
  }

  async listSystemConfig() {
    return prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
  }

  async setSystemConfig(key: string, value: unknown) {
    const jsonValue = this.toJson(value);
    return prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: jsonValue },
      update: { value: jsonValue },
    });
  }

  async applyConfig(actorId?: string) {
    const snapshot = await this.takeSnapshot();
    return prisma.configRevision.create({
      data: {
        scope: "full",
        payload: snapshot,
        status: ConfigRevisionStatus.APPLIED,
        actorId,
        appliedAt: new Date(),
      },
    });
  }

  async rollbackConfig(revisionId: string, actorId?: string) {
    const revision = await prisma.configRevision.findUniqueOrThrow({
      where: { id: revisionId },
    });
    const payload = revision.payload as {
      providers: Array<{
        id: string;
        type: IntegrationType;
        name: string;
        endpointUrl: string | null;
        config: object | null;
        status: IntegrationStatus;
      }>;
      secrets: Array<{
        providerId: string;
        keyName: string;
        cipherText: string;
        iv: string;
        version: number;
      }>;
      sipTrunks: Array<{
        providerId: string;
        endpointName: string;
        host: string;
        port: number;
        username: string | null;
        fromDomain: string | null;
        outboundProxy: string | null;
        didNumbers: object | null;
        codecs: object | null;
        transport: string;
        isDefault: boolean;
      }>;
      routingRules: Array<{
        direction: RoutingDirection;
        matchExpr: string;
        action: RoutingAction;
        target: string;
        priority: number;
        enabled: boolean;
        description: string | null;
      }>;
      systemConfig: Array<{ key: string; value: object }>;
    };

    await prisma.$transaction(async (tx) => {
      await tx.integrationSecret.deleteMany({});
      await tx.sipTrunk.deleteMany({});
      await tx.integrationProvider.deleteMany({});
      await tx.routingRule.deleteMany({});
      await tx.systemConfig.deleteMany({});

      for (const p of payload.providers) {
        await tx.integrationProvider.create({
          data: {
            id: p.id,
            type: p.type,
            name: p.name,
            endpointUrl: p.endpointUrl,
            config: this.toNullableJson(p.config),
            status: p.status,
          },
        });
      }

      for (const s of payload.secrets) {
        await tx.integrationSecret.create({ data: s });
      }
      for (const t of payload.sipTrunks) {
        await tx.sipTrunk.create({
          data: {
            ...t,
            didNumbers: this.toNullableJson(t.didNumbers),
            codecs: this.toNullableJson(t.codecs),
          },
        });
      }
      for (const r of payload.routingRules) {
        await tx.routingRule.create({ data: r });
      }
      for (const c of payload.systemConfig) {
        await tx.systemConfig.create({ data: c });
      }

      await tx.configRevision.update({
        where: { id: revisionId },
        data: { status: ConfigRevisionStatus.ROLLED_BACK },
      });

      await tx.configRevision.create({
        data: {
          scope: "full",
          payload,
          status: ConfigRevisionStatus.APPLIED,
          actorId,
          appliedAt: new Date(),
        },
      });
    });

    return { ok: true };
  }

  async listRevisions() {
    return prisma.configRevision.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  private async takeSnapshot() {
    const [providers, secrets, sipTrunks, routingRules, systemConfig] =
      await Promise.all([
        prisma.integrationProvider.findMany(),
        prisma.integrationSecret.findMany(),
        prisma.sipTrunk.findMany(),
        prisma.routingRule.findMany(),
        prisma.systemConfig.findMany(),
      ]);

    return {
      providers: providers.map((p) => ({
        id: p.id,
        type: p.type,
        name: p.name,
        endpointUrl: p.endpointUrl,
        config: p.config,
        status: p.status,
      })),
      secrets: secrets.map((s) => ({
        providerId: s.providerId,
        keyName: s.keyName,
        cipherText: s.cipherText,
        iv: s.iv,
        version: s.version,
      })),
      sipTrunks: sipTrunks.map((s) => ({
        providerId: s.providerId,
        endpointName: s.endpointName,
        host: s.host,
        port: s.port,
        username: s.username,
        fromDomain: s.fromDomain,
        outboundProxy: s.outboundProxy,
        didNumbers: s.didNumbers,
        codecs: s.codecs,
        transport: s.transport,
        isDefault: s.isDefault,
      })),
      routingRules: routingRules.map((r) => ({
        direction: r.direction,
        matchExpr: r.matchExpr,
        action: r.action,
        target: r.target,
        priority: r.priority,
        enabled: r.enabled,
        description: r.description,
      })),
      systemConfig: systemConfig.map((c) => ({ key: c.key, value: c.value })),
    };
  }

  // ── VAPI helpers ──────────────────────────────────────────────────────────

  async getVapiConfig() {
    const row = await prisma.systemConfig.findUnique({ where: { key: "vapi.config" } });
    const cfg = (row?.value ?? {}) as Record<string, string>;
    return {
      assistantId: cfg.assistantId ?? "",
      phoneNumberId: cfg.phoneNumberId ?? "",
      webhookSecret: cfg.webhookSecret ?? "",
      // Never expose the API key — only indicate if it's set
      apiKeySet: !!(cfg.apiKey),
    };
  }

  async saveVapiConfig(input: Record<string, string>) {
    const existing = await prisma.systemConfig.findUnique({ where: { key: "vapi.config" } });
    const prev = (existing?.value ?? {}) as Record<string, string>;

    const next: Record<string, string> = {
      ...prev,
      ...(input.assistantId !== undefined ? { assistantId: input.assistantId } : {}),
      ...(input.phoneNumberId !== undefined ? { phoneNumberId: input.phoneNumberId } : {}),
      ...(input.webhookSecret !== undefined ? { webhookSecret: input.webhookSecret } : {}),
      // Only update apiKey if a non-empty value was provided
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    };

    await prisma.systemConfig.upsert({
      where: { key: "vapi.config" },
      create: { key: "vapi.config", value: next },
      update: { value: next },
    });

    return this.getVapiConfig();
  }

  async testVapiConnection() {
    const row = await prisma.systemConfig.findUnique({ where: { key: "vapi.config" } });
    const cfg = (row?.value ?? {}) as Record<string, string>;
    const apiKey = cfg.apiKey ?? process.env.VAPI_API_KEY ?? "";
    const assistantId = cfg.assistantId ?? process.env.VAPI_ASSISTANT_ID ?? "";

    if (!apiKey) return { ok: false, details: "API Key не задан" };
    if (!assistantId) return { ok: false, details: "Assistant ID не задан" };

    try {
      const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        return { ok: true, details: `✓ Assistant: "${data.name ?? assistantId}"` };
      }
      return { ok: false, details: `HTTP ${res.status}: ${await res.text()}` };
    } catch (e) {
      return { ok: false, details: (e as Error)?.message ?? String(e) };
    }
  }
}
