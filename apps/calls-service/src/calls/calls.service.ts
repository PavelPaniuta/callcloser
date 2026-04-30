import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { CallDirection, CallStatus, prisma } from "@crm/db";
import { AriService } from "./ari.service";
import { VapiService } from "./vapi.service";
import { v4 as uuid } from "uuid";

export interface EndCallPayload {
  callId: string;
  recordingKey?: string;
  failureReason?: string;
}

@Injectable()
export class CallsService {
  private readonly log = new Logger(CallsService.name);
  private readonly redisPub: Redis | null;

  constructor(
    @InjectQueue("call-ended") private readonly endedQueue: Queue,
    private readonly ari: AriService,
    private readonly vapi: VapiService,
  ) {
    const url = process.env.REDIS_URL;
    this.redisPub = url ? new Redis(url, { lazyConnect: true }) : null;
  }

  private async publishEvent(payload: object) {
    if (!this.redisPub) return;
    try {
      if (this.redisPub.status !== "ready") await this.redisPub.connect();
      await this.redisPub.publish("call-events", JSON.stringify(payload));
    } catch (e) {
      this.log.warn(`redis publish failed: ${(e as Error).message}`);
    }
  }

  async get(id: string) {
    const c = await prisma.call.findUnique({
      where: { id },
      include: { contact: true, analytics: true, promptVersion: true },
    });
    if (!c) throw new NotFoundException("Call not found");
    return c;
  }

  async listForContact(contactId: string) {
    return prisma.call.findMany({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { analytics: true },
    });
  }

  async listRecent() {
    return prisma.call.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { contact: true, analytics: true },
    });
  }

  async listFiltered(input: {
    status?: CallStatus;
    direction?: CallDirection;
    limit?: number;
  }) {
    return prisma.call.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.direction ? { direction: input.direction } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
      include: { contact: true, analytics: true },
    });
  }

  async createOutbound(input: {
    contactId?: string;
    phone: string;
    promptVersionId?: string;
    engine?: "asterisk" | "vapi";
  }) {
    const call = await prisma.call.create({
      data: {
        direction: CallDirection.OUTBOUND,
        status: CallStatus.CREATED,
        contactId: input.contactId,
        promptVersionId: input.promptVersionId,
      },
    });

    const simulate =
      process.env.SIMULATE_CALLS === "true" || !this.ari.isEnabled();

    if (simulate) {
      await this.transition(call.id, CallStatus.QUEUED);
      await this.transition(call.id, CallStatus.RINGING);
      await this.transition(call.id, CallStatus.ANSWERED);
      setTimeout(() => {
        void this.finalizeEnded(call.id, {
          recordingKey: `simulated/${call.id}.wav`,
        });
      }, 1500);
      return this.get(call.id);
    }

    await this.transition(call.id, CallStatus.QUEUED);

    // Determine engine:
    // - "vapi"     → VAPI API outbound (VAPI dials via your SIP trunk, handles AI)
    // - "asterisk" → Asterisk ARI outbound (local OpenAI pipeline)
    // - not set    → auto: VAPI if configured, else ARI
    const useVapi =
      input.engine === "vapi" ||
      (input.engine == null && (await this.vapi.isConfigured()));

    // ── VAPI path ──────────────────────────────────────────────────────────
    if (useVapi) {
      let systemPrompt: string | undefined;
      if (input.promptVersionId) {
        const promptRow = await prisma.promptVersion.findUnique({
          where: { id: input.promptVersionId },
          select: { systemPrompt: true },
        });
        systemPrompt = promptRow?.systemPrompt ?? undefined;
      }

      const vapiResult = await this.vapi.originateCall(
        input.phone,
        call.id,
        { metadata: { crm_call_id: call.id }, systemPrompt },
      );
      if (!vapiResult) {
        await prisma.call.update({
          where: { id: call.id },
          data: { status: CallStatus.FAILED, failureReason: "VAPI originate failed" },
        });
        return this.get(call.id);
      }
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.RINGING,
          asteriskUniqueId: vapiResult.callId,
          startedAt: new Date(),
        },
      });
      return this.get(call.id);
    }

    // ── Asterisk ARI path ──────────────────────────────────────────────────
    const orig = await this.ari.originateOutbound(input.phone, call.id);
    if (!orig?.uniqueId) {
      await prisma.call.update({
        where: { id: call.id },
        data: { status: CallStatus.FAILED, failureReason: "ARI originate failed" },
      });
      return this.get(call.id);
    }

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: CallStatus.RINGING,
        asteriskUniqueId: orig.uniqueId,
        channelId: orig.channelId,
        startedAt: new Date(),
      },
    });
    return this.get(call.id);
  }

  async createInboundStub(callerPhone: string, promptVersionId?: string) {
    const contact = await prisma.contact.findUnique({
      where: { phone: callerPhone },
    });
    const call = await prisma.call.create({
      data: {
        direction: CallDirection.INBOUND,
        status: CallStatus.RINGING,
        contactId: contact?.id,
        promptVersionId,
        asteriskUniqueId: `in-${uuid()}`,
        startedAt: new Date(),
      },
    });
    return call;
  }

  async transition(id: string, status: CallStatus) {
    const extra: Record<string, unknown> = {};
    if (status === CallStatus.ANSWERED) {
      extra.startedAt = new Date();
    }
    const row = await prisma.call.update({
      where: { id },
      data: { status, ...extra },
    });
    await this.publishEvent({ callId: id, status, event: "call.updated" });
    return row;
  }

  async finalizeEnded(
    callId: string,
    opts?: { recordingKey?: string; failureReason?: string },
  ) {
    const endedAt = new Date();
    const call = await prisma.call.update({
      where: { id: callId },
      data: {
        status: opts?.failureReason ? CallStatus.FAILED : CallStatus.ENDED,
        endedAt,
        recordingObjectKey: opts?.recordingKey,
        failureReason: opts?.failureReason,
      },
    });
    await this.endedQueue.add(
      "analyze",
      { callId: call.id },
      { removeOnComplete: true, attempts: 3 },
    );
    this.log.log(`call-ended queued analytics for ${call.id}`);
    await this.publishEvent({
      callId: call.id,
      status: call.status,
      event: "call.ended",
    });
    return call;
  }

  async cancelCall(id: string, reason = "Cancelled by user") {
    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) throw new NotFoundException("Call not found");
    if (call.status === CallStatus.ENDED || call.status === CallStatus.FAILED) {
      return this.get(id);
    }

    if (call.channelId) {
      await this.ari.hangupChannel(call.channelId);
    }

    await this.finalizeEnded(id, { failureReason: reason });
    return this.get(id);
  }

  async retryCall(id: string) {
    const source = await prisma.call.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!source) throw new NotFoundException("Call not found");
    if (!source.contact?.phone) {
      throw new BadRequestException(
        "Cannot retry call without contact phone number",
      );
    }
    return this.createOutbound({
      contactId: source.contactId ?? undefined,
      phone: source.contact.phone,
      promptVersionId: source.promptVersionId ?? undefined,
    });
  }

  async deleteCall(id: string) {
    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) throw new NotFoundException("Call not found");
    if (
      call.status === CallStatus.CREATED ||
      call.status === CallStatus.QUEUED ||
      call.status === CallStatus.RINGING ||
      call.status === CallStatus.ANSWERED
    ) {
      throw new BadRequestException("Cannot delete active call");
    }
    await prisma.call.delete({ where: { id } });
    return { ok: true };
  }

  async saveTranscript(callId: string, transcript: string) {
    await prisma.callAnalytics.upsert({
      where: { callId },
      create: { callId, transcript },
      update: { transcript },
    });
    return { ok: true };
  }

  async clearHistory(contactId?: string) {
    const result = await prisma.call.deleteMany({
      where: {
        ...(contactId ? { contactId } : {}),
        status: { in: [CallStatus.ENDED, CallStatus.FAILED] },
      },
    });
    return { ok: true, deleted: result.count };
  }

  async attachChannel(callId: string, uniqueId: string, channelId?: string) {
    return prisma.call.update({
      where: { id: callId },
      data: {
        asteriskUniqueId: uniqueId,
        channelId: channelId ?? uniqueId,
        status: CallStatus.RINGING,
        startedAt: new Date(),
      },
    });
  }

  async findByAsteriskUniqueId(uniqueId: string) {
    return prisma.call.findFirst({
      where: { asteriskUniqueId: uniqueId },
    });
  }
}
