import { HttpService } from "@nestjs/axios";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { prisma } from "@crm/db";
import { randomUUID } from "crypto";
import { firstValueFrom } from "rxjs";

type CampaignStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

type CampaignLead = {
  name?: string;
  phone: string;
};

type CampaignPolicy = {
  globalConcurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
};

export type CampaignRun = {
  id: string;
  name: string;
  assistantLabel?: string;
  promptVersionId: string;
  engine?: "asterisk" | "vapi";
  status: CampaignStatus;
  total: number;
  processed: number;
  launched: number;
  failed: number;
  createdContacts: number;
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
  logs: string[];
  createdAt: string;
  startedAt: string;
  finishedAt?: string;
  cancelRequested: boolean;
  leads?: CampaignLead[];
};

@Injectable()
export class CampaignRunnerService implements OnModuleInit {
  private readonly runs = new Map<string, CampaignRun>();
  private readonly waitQueue: Array<() => void> = [];
  private activeSlots = 0;
  private policy: CampaignPolicy = {
    globalConcurrency: 30,
    maxAttempts: 2,
    retryDelayMs: 1500,
  };
  private dncPhones = new Set<string>();

  constructor(private readonly http: HttpService) {}

  async onModuleInit() {
    await this.loadState();
  }

  list() {
    return [...this.runs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string) {
    return this.runs.get(id) ?? null;
  }

  getPolicy() {
    return this.policy;
  }

  async setPolicy(input: Partial<CampaignPolicy>) {
    this.policy = {
      globalConcurrency: Math.min(
        Math.max(input.globalConcurrency ?? this.policy.globalConcurrency, 1),
        100,
      ),
      maxAttempts: Math.min(
        Math.max(input.maxAttempts ?? this.policy.maxAttempts, 1),
        10,
      ),
      retryDelayMs: Math.min(
        Math.max(input.retryDelayMs ?? this.policy.retryDelayMs, 0),
        60000,
      ),
    };
    await this.persistState();
    return this.policy;
  }

  listDnc() {
    return [...this.dncPhones.values()].sort();
  }

  async addDnc(phone: string) {
    const normalized = this.normalizePhone(phone);
    if (!/^\+[0-9]{10,15}$/.test(normalized)) {
      throw new Error("Invalid phone number");
    }
    this.dncPhones.add(normalized);
    await this.persistState();
    return this.listDnc();
  }

  async removeDnc(phone: string) {
    const normalized = this.normalizePhone(phone);
    this.dncPhones.delete(normalized);
    await this.persistState();
    return this.listDnc();
  }

  async cancel(id: string) {
    const run = this.runs.get(id);
    if (!run) return null;
    run.cancelRequested = true;
    this.pushLog(run, "[INFO] Cancel requested by user");
    await this.persistState();
    return run;
  }

  start(input: {
    name?: string;
    assistantLabel?: string;
    promptVersionId: string;
    engine?: "asterisk" | "vapi";
    leads: CampaignLead[];
    concurrency?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
  }) {
    const cleaned = input.leads
      .map((x) => ({
        name: x.name?.trim() || undefined,
        phone: this.normalizePhone(x.phone),
      }))
      .filter((x) => /^\+[0-9]{10,15}$/.test(x.phone))
      .filter((x) => !this.dncPhones.has(x.phone));

    const id = randomUUID();
    const run: CampaignRun = {
      id,
      name: input.name?.trim() || `Campaign ${new Date().toLocaleString()}`,
      assistantLabel: input.assistantLabel?.trim() || undefined,
      promptVersionId: input.promptVersionId,
      engine: input.engine,
      status: "RUNNING",
      total: cleaned.length,
      processed: 0,
      launched: 0,
      failed: 0,
      createdContacts: 0,
      concurrency: Math.min(Math.max(input.concurrency ?? 5, 1), 200),
      maxAttempts: Math.min(
        Math.max(input.maxAttempts ?? this.policy.maxAttempts, 1),
        10,
      ),
      retryDelayMs: Math.min(
        Math.max(input.retryDelayMs ?? this.policy.retryDelayMs, 0),
        60000,
      ),
      logs: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      cancelRequested: false,
      leads: cleaned,
    };
    this.runs.set(id, run);
    void this.persistState();
    void this.execute(run, cleaned);
    return run;
  }

  restart(id: string) {
    const original = this.runs.get(id);
    if (!original) throw new Error(`Campaign ${id} not found`);
    if (original.status === "RUNNING") throw new Error("Campaign is already running");

    const leads = original.leads ?? [];
    if (leads.length === 0) throw new Error("No leads stored for this campaign (was created before restart feature)");

    return this.start({
      name: `${original.name} (повтор ${new Date().toLocaleString()})`,
      assistantLabel: original.assistantLabel,
      promptVersionId: original.promptVersionId,
      leads,
      concurrency: original.concurrency,
      maxAttempts: original.maxAttempts,
      retryDelayMs: original.retryDelayMs,
    });
  }

  private normalizePhone(raw: string): string {
    const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
    if (!cleaned) return "";
    if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\D/g, "")}`;
    return `+${cleaned.replace(/\D/g, "")}`;
  }

  private pushLog(run: CampaignRun, line: string) {
    run.logs = [`${new Date().toISOString()} ${line}`, ...run.logs].slice(0, 200);
  }

  private async execute(run: CampaignRun, leads: CampaignLead[]) {
    try {
      const contactsMap = await this.loadContactsMap();
      let cursor = 0;

      const worker = async () => {
        while (cursor < leads.length && !run.cancelRequested) {
          const idx = cursor++;
          const lead = leads[idx];
          await this.processLead(run, lead, contactsMap);
          run.processed += 1;
          await this.persistState();
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(run.concurrency, leads.length) }).map(() =>
          worker(),
        ),
      );

      run.finishedAt = new Date().toISOString();
      if (run.cancelRequested) {
        run.status = "CANCELLED";
      } else if (run.failed > 0 && run.launched === 0) {
        run.status = "FAILED";
      } else {
        run.status = "COMPLETED";
      }
      this.pushLog(
        run,
        `[DONE] status=${run.status} launched=${run.launched} failed=${run.failed}`,
      );
      await this.persistState();
    } catch (e: unknown) {
      run.status = "FAILED";
      run.finishedAt = new Date().toISOString();
      this.pushLog(run, `[FATAL] ${(e as Error)?.message ?? String(e)}`);
      await this.persistState();
    }
  }

  private async processLead(
    run: CampaignRun,
    lead: CampaignLead,
    contactsMap: Map<string, string>,
  ) {
    const contactId = await this.ensureContact(run, lead, contactsMap);

    for (let attempt = 1; attempt <= run.maxAttempts; attempt += 1) {
      if (run.cancelRequested) return;
      try {
        await this.acquireGlobalSlot();
        const response = await firstValueFrom(
          this.http.post(
            `${process.env.CALLS_SERVICE_URL ?? "http://localhost:3012"}/calls/outbound`,
            {
              phone: lead.phone,
              contactId,
              promptVersionId: run.promptVersionId,
              ...(run.engine ? { engine: run.engine } : {}),
            },
            { validateStatus: () => true },
          ),
        );
        this.releaseGlobalSlot();

        const data = response.data as { status?: string } | undefined;
        const failedOnCreate =
          response.status < 200 ||
          response.status >= 300 ||
          data?.status === "FAILED";
        if (!failedOnCreate) {
          run.launched += 1;
          this.pushLog(run, `[CALL OK] ${lead.phone} attempt=${attempt}`);
          return;
        }

        if (attempt >= run.maxAttempts) {
          run.failed += 1;
          this.pushLog(
            run,
            `[CALL FAIL] ${lead.phone} status=${response.status} attempts=${attempt}`,
          );
          return;
        }
        this.pushLog(run, `[RETRY] ${lead.phone} nextAttempt=${attempt + 1}`);
        await this.sleep(run.retryDelayMs);
      } catch (e: unknown) {
        this.releaseGlobalSlot();
        if (attempt >= run.maxAttempts) {
          run.failed += 1;
          this.pushLog(
            run,
            `[CALL FAIL] ${lead.phone} ${(e as Error)?.message ?? e}`,
          );
          return;
        }
        this.pushLog(run, `[RETRY] ${lead.phone} nextAttempt=${attempt + 1}`);
        await this.sleep(run.retryDelayMs);
      }
    }
  }

  private async acquireGlobalSlot() {
    if (this.activeSlots < this.policy.globalConcurrency) {
      this.activeSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeSlots += 1;
        resolve();
      });
    });
  }

  private releaseGlobalSlot() {
    if (this.activeSlots > 0) this.activeSlots -= 1;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  private async loadContactsMap() {
    const response = await firstValueFrom(
      this.http.get<{ id: string; phone: string }[]>(
        `${process.env.CRM_SERVICE_URL ?? "http://localhost:3011"}/contacts`,
        { validateStatus: () => true },
      ),
    );
    const rows = response.status >= 200 && response.status < 300 ? response.data : [];
    return new Map(rows.map((x) => [x.phone, x.id]));
  }

  private async ensureContact(
    run: CampaignRun,
    lead: CampaignLead,
    contactsMap: Map<string, string>,
  ) {
    const cached = contactsMap.get(lead.phone);
    if (cached) return cached;

    const createResponse = await firstValueFrom(
      this.http.post<{ id: string; phone: string }>(
        `${process.env.CRM_SERVICE_URL ?? "http://localhost:3011"}/contacts`,
        {
          phone: lead.phone,
          name: lead.name,
        },
        { validateStatus: () => true },
      ),
    );

    if (createResponse.status >= 200 && createResponse.status < 300) {
      contactsMap.set(createResponse.data.phone, createResponse.data.id);
      run.createdContacts += 1;
      return createResponse.data.id;
    }

    const refreshed = await this.loadContactsMap();
    const fallback = refreshed.get(lead.phone);
    if (fallback) {
      contactsMap.set(lead.phone, fallback);
      return fallback;
    }

    throw new Error(`Contact create failed for ${lead.phone}`);
  }

  private async loadState() {
    const [runsCfg, policyCfg, dncCfg] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: "campaign.runs" } }),
      prisma.systemConfig.findUnique({ where: { key: "campaign.policy" } }),
      prisma.systemConfig.findUnique({ where: { key: "campaign.dnc" } }),
    ]);

    const persistedRuns = (runsCfg?.value ?? []) as CampaignRun[];
    for (const run of persistedRuns) {
      if (run.status === "RUNNING") {
        run.status = "FAILED";
        run.finishedAt = new Date().toISOString();
        run.cancelRequested = true;
        run.logs = [
          `${new Date().toISOString()} [RECOVERED] Marked as FAILED after restart`,
          ...(run.logs ?? []),
        ].slice(0, 200);
      }
      this.runs.set(run.id, run);
    }

    const policyValue = (policyCfg?.value ?? {}) as Partial<CampaignPolicy>;
    this.policy = {
      globalConcurrency: Math.min(
        Math.max(Number(policyValue.globalConcurrency ?? 8), 1),
        100,
      ),
      maxAttempts: Math.min(Math.max(Number(policyValue.maxAttempts ?? 2), 1), 10),
      retryDelayMs: Math.min(
        Math.max(Number(policyValue.retryDelayMs ?? 1500), 0),
        60000,
      ),
    };

    const dncValue = (dncCfg?.value ?? []) as string[];
    this.dncPhones = new Set(
      dncValue.map((v) => this.normalizePhone(v)).filter((v) => /^\+[0-9]{10,15}$/.test(v)),
    );

    await this.persistState();
  }

  private async persistState() {
    const runRows = [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
    await Promise.all([
      prisma.systemConfig.upsert({
        where: { key: "campaign.runs" },
        create: { key: "campaign.runs", value: runRows },
        update: { value: runRows },
      }),
      prisma.systemConfig.upsert({
        where: { key: "campaign.policy" },
        create: { key: "campaign.policy", value: this.policy },
        update: { value: this.policy },
      }),
      prisma.systemConfig.upsert({
        where: { key: "campaign.dnc" },
        create: { key: "campaign.dnc", value: [...this.dncPhones.values()] },
        update: { value: [...this.dncPhones.values()] },
      }),
    ]);
  }

  private async sleep(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
