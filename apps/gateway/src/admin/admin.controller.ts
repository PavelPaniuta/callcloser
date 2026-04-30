import { HttpService } from "@nestjs/axios";
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { prisma } from "@crm/db";
import { firstValueFrom } from "rxjs";
import { CampaignRunnerService } from "./campaign-runner.service";
import {
  IsArray,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

type HealthRow = {
  name: string;
  url: string;
};

class CampaignLeadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;
}

class StartCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  assistantLabel?: string;

  @IsString()
  promptVersionId!: string;

  @IsOptional()
  @IsIn(["asterisk", "vapi"])
  engine?: "asterisk" | "vapi";

  @ValidateNested({ each: true })
  @Type(() => CampaignLeadDto)
  @IsArray()
  @ArrayMinSize(1)
  leads!: CampaignLeadDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  concurrency?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  retryDelayMs?: number;
}

class UpdatePolicyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  globalConcurrency?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  retryDelayMs?: number;
}

class DncDto {
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;
}

@Controller("api/admin")
export class AdminController {
  constructor(
    private readonly http: HttpService,
    private readonly campaignRunner: CampaignRunnerService,
  ) {}

  @Get("health")
  async health() {
    const targets: HealthRow[] = [
      { name: "gateway", url: "http://localhost:3010/health" },
      {
        name: "crm-service",
        url: `${process.env.CRM_SERVICE_URL ?? "http://localhost:3011"}/health`,
      },
      {
        name: "calls-service",
        url: `${process.env.CALLS_SERVICE_URL ?? "http://localhost:3012"}/health`,
      },
      {
        name: "prompt-service",
        url: `${process.env.PROMPT_SERVICE_URL ?? "http://localhost:3013"}/health`,
      },
    ];

    const rows = await Promise.all(
      targets.map(async (t) => {
        try {
          const started = Date.now();
          const r = await firstValueFrom(
            this.http.get(t.url, {
              timeout: 3000,
              validateStatus: () => true,
            }),
          );
          return {
            service: t.name,
            ok: r.status >= 200 && r.status < 300,
            statusCode: r.status,
            latencyMs: Date.now() - started,
          };
        } catch {
          return {
            service: t.name,
            ok: false,
            statusCode: 0,
            latencyMs: null,
          };
        }
      }),
    );

    return {
      ok: rows.every((r) => r.ok),
      checkedAt: new Date().toISOString(),
      services: rows,
    };
  }

  @Get("calls/overview")
  async callsOverview() {
    const [recent, grouped] = await Promise.all([
      prisma.call.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.call.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

    const byStatus = grouped.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count;
      return acc;
    }, {});

    const failed = recent.filter((c) => c.status === "FAILED");
    const topFailureReasons = Object.entries(
      failed.reduce<Record<string, number>>((acc, c) => {
        const key = c.failureReason?.trim() || "Unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      total: recent.length,
      byStatus,
      topFailureReasons,
    };
  }

  @Get("audit")
  async audit(@Query("limit") limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw ?? "50") || 50, 1), 200);
    return prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  @Get("campaigns")
  campaigns() {
    return this.campaignRunner.list();
  }

  @Get("campaigns/policy")
  campaignsPolicy() {
    return this.campaignRunner.getPolicy();
  }

  @Post("campaigns/start")
  startCampaign(@Body() body: StartCampaignDto) {
    return this.campaignRunner.start({
      name: body.name,
      assistantLabel: body.assistantLabel,
      promptVersionId: body.promptVersionId,
      engine: body.engine,
      leads: body.leads,
      concurrency: body.concurrency,
      maxAttempts: body.maxAttempts,
      retryDelayMs: body.retryDelayMs,
    });
  }

  @Post("campaigns/policy")
  updateCampaignPolicy(@Body() body: UpdatePolicyDto) {
    return this.campaignRunner.setPolicy(body);
  }

  @Post("campaigns/:id/cancel")
  cancelCampaign(@Param("id") id: string) {
    return this.campaignRunner.cancel(id);
  }

  @Post("campaigns/:id/restart")
  restartCampaign(@Param("id") id: string) {
    return this.campaignRunner.restart(id);
  }

  @Get("campaigns/dnc")
  listDnc() {
    return this.campaignRunner.listDnc();
  }

  @Post("campaigns/dnc/add")
  addDnc(@Body() body: DncDto) {
    return this.campaignRunner.addDnc(body.phone);
  }

  @Post("campaigns/dnc/remove")
  removeDnc(@Body() body: DncDto) {
    return this.campaignRunner.removeDnc(body.phone);
  }

  @Get("campaigns/:id")
  campaign(@Param("id") id: string) {
    return this.campaignRunner.get(id);
  }

  // ── Stuck call cleanup ────────────────────────────────────────────────────

  @Post("calls/cleanup-stuck")
  async cleanupStuck(@Body() body: { olderThanSeconds?: number }) {
    const threshold = body.olderThanSeconds ?? 120; // default 2 min
    const cutoff = new Date(Date.now() - threshold * 1000);
    const result = await prisma.call.updateMany({
      where: {
        status: { in: ["RINGING", "QUEUED", "CREATED"] as never[] },
        createdAt: { lt: cutoff },
      },
      data: { status: "FAILED" as never, failureReason: "Timeout — stuck in RINGING/QUEUED" },
    });
    return { updated: result.count, cutoff: cutoff.toISOString() };
  }

  @Get("calls/stuck")
  async stuckCalls() {
    const cutoff = new Date(Date.now() - 120_000);
    return prisma.call.findMany({
      where: {
        status: { in: ["RINGING", "QUEUED", "CREATED"] as never[] },
        createdAt: { lt: cutoff },
      },
      include: { contact: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  // ── Hot Calls (stop words detected) ──────────────────────────────────────

  @Get("hot-calls")
  async hotCalls(@Query("status") status?: string) {
    // Use reviewStatus != null as proxy for "has detected keywords"
    // (analytics-worker sets reviewStatus when keywords are found)
    const analytics = await (prisma.callAnalytics as unknown as {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    }).findMany({
      where: status
        ? { reviewStatus: status }
        : { reviewStatus: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { call: { include: { contact: true } } },
    });

    return analytics.map((a) => {
      const call = a["call"] as Record<string, unknown> | null;
      const contact = (call?.["contact"] as Record<string, unknown> | null) ?? null;
      return {
        id: a["id"],
        callId: a["callId"],
        reviewStatus: a["reviewStatus"],
        reviewNote: a["reviewNote"],
        reviewedAt: a["reviewedAt"],
        telegramSent: a["telegramSent"],
        detectedKeywords: a["detectedKeywords"],
        summary: a["summary"],
        transcript: a["transcript"],
        createdAt: a["createdAt"],
        contact: contact
          ? { id: contact["id"], name: contact["name"], phone: contact["phone"] }
          : null,
        callDirection: call?.["direction"] ?? null,
        callStatus: call?.["status"] ?? null,
      };
    });
  }

  @Get("hot-calls/count")
  async hotCallsCount() {
    const count = await prisma.callAnalytics.count({
      where: { reviewStatus: { in: ["PENDING_REVIEW", "IN_PROGRESS"] as never[] } },
    });
    return { count };
  }

  @Put("hot-calls/:id/status")
  async updateHotCallStatus(
    @Param("id") id: string,
    @Body() body: { reviewStatus: string; reviewNote?: string },
  ) {
    return prisma.callAnalytics.update({
      where: { id },
      data: {
        reviewStatus: body.reviewStatus as never,
        reviewNote: body.reviewNote,
        reviewedAt: ["REVIEWED", "CLOSED"].includes(body.reviewStatus) ? new Date() : undefined,
      },
    });
  }

  // ── Phone Bases ────────────────────────────────────────────

  @Get("phone-bases")
  async listPhoneBases() {
    return prisma.phoneBase.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, count: true, createdAt: true },
    });
  }

  @Post("phone-bases")
  async createPhoneBase(@Body() body: { name: string; numbers: { phone: string; name?: string }[] }) {
    const count = body.numbers?.length ?? 0;
    return prisma.phoneBase.create({
      data: { name: body.name, numbers: body.numbers ?? [], count },
    });
  }

  @Get("phone-bases/:id")
  async getPhoneBase(@Param("id") id: string) {
    return prisma.phoneBase.findUniqueOrThrow({ where: { id } });
  }

  @Put("phone-bases/:id")
  async updatePhoneBase(
    @Param("id") id: string,
    @Body() body: { name?: string; numbers?: { phone: string; name?: string }[] },
  ) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.numbers !== undefined) {
      data.numbers = body.numbers;
      data.count = body.numbers.length;
    }
    return prisma.phoneBase.update({ where: { id }, data });
  }

  @Delete("phone-bases/:id")
  async deletePhoneBase(@Param("id") id: string) {
    await prisma.phoneBase.delete({ where: { id } });
    return { ok: true };
  }
}
