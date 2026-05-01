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
    // Cleanup calls stuck in an active state for more than 10 minutes.
    // Handles the case where the voicebot restarts mid-call and loses track.
    setInterval(() => void this.cleanupStuckCalls(), 2 * 60 * 1000);
  }

  private async cleanupStuckCalls() {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    try {
      const stuck = await prisma.call.findMany({
        where: {
          status: {
            in: [CallStatus.CREATED, CallStatus.QUEUED, CallStatus.RINGING, CallStatus.ANSWERED],
          },
          createdAt: { lt: cutoff },
        },
        select: { id: true },
      });
      if (stuck.length === 0) return;
      this.log.warn(`cleanup: finalizing ${stuck.length} stuck call(s)`);
      for (const { id } of stuck) {
        await this.finalizeEnded(id, { failureReason: "timeout_cleanup" }).catch((e: unknown) => {
          this.log.warn(`cleanup finalize ${id} failed: ${(e as Error)?.message ?? e}`);
        });
      }
    } catch (e: unknown) {
      this.log.warn(`cleanupStuckCalls error: ${(e as Error)?.message ?? e}`);
    }
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

  /**
   * Набір на Zadarma / SIP-транк.
   * Для України багато акаунтів Zadarma очікують міжнародний формат **380XXXXXXXXX** у Request-URI;
   * національний **0XXXXXXXXX** іноді не доходить до GSM (у абонента немає дзвінка / пропущених).
   * ZADARMA_OUTBOUND_FORMAT=national — примусово 0XXXXXXXXX (старий режим).
   */
  private normalizePhoneForZadarmaTrunk(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    const national =
      (process.env.ZADARMA_OUTBOUND_FORMAT ?? "international").toLowerCase() === "national";

    if (digits.startsWith("380") && digits.length === 12) {
      return national ? `0${digits.slice(3)}` : digits;
    }
    // UA mobile / landline in national form: 0XXXXXXXXX (10 digits)
    if (digits.startsWith("0") && digits.length === 10) {
      return national ? digits : `380${digits.slice(1)}`;
    }
    if (digits.length >= 10 && digits.length <= 15) return digits;
    return phone.trim();
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

    // ── Asterisk ARI ───────────────────────────────────────────────────────
    // За замовчуванням лише власний пайплайн (Zadarma → Stasis → GPT/TTS).
    // VAPI-міст увімкнути окремо: OUTBOUND_USE_VAPI=true у .env (і engine=vapi у запиті).
    const vapiAllowed =
      process.env.OUTBOUND_USE_VAPI === "true" ||
      process.env.OUTBOUND_USE_VAPI === "1";
    let direction = "outbound";
    if (vapiAllowed && input.engine === "vapi") direction = "outbound-vapi";
    else if (input.engine === "vapi" && !vapiAllowed) {
      this.log.warn(
        `createOutbound ${call.id}: engine=vapi ignored (set OUTBOUND_USE_VAPI=true to enable); using Asterisk GPT/TTS`,
      );
    }
    const dialPhone = this.normalizePhoneForZadarmaTrunk(input.phone);
    const orig = await this.ari.originateOutbound(dialPhone, call.id, direction);
    if (!orig?.uniqueId) {
      await prisma.call.update({
        where: { id: call.id },
        data: { status: CallStatus.FAILED, failureReason: "ARI originate failed" },
      });
      return this.get(call.id);
    }

    /** Залишаємо QUEUED: RINGING одразу після originate змушував CRM показувати «гудки», хоча PSTN ще може не дзвонити. ANSWERED виставить voicebot. */
    await prisma.call.update({
      where: { id: call.id },
      data: {
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
    try {
      await this.endedQueue.add(
        "analyze",
        { callId: call.id },
        { removeOnComplete: true, attempts: 3 },
      );
      this.log.log(`call-ended queued analytics for ${call.id}`);
    } catch (e: unknown) {
      this.log.warn(`analytics queue failed for ${call.id}: ${(e as Error)?.message ?? e}`);
    }
    try {
      await this.publishEvent({
        callId: call.id,
        status: call.status,
        event: "call.ended",
      });
    } catch (e: unknown) {
      this.log.warn(`publishEvent failed: ${(e as Error)?.message ?? e}`);
    }
    return call;
  }

  async cancelCall(id: string, reason = "Cancelled by user") {
    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) throw new NotFoundException("Call not found");
    if (call.status === CallStatus.ENDED || call.status === CallStatus.FAILED) {
      return this.get(id);
    }

    if (call.channelId) {
      const ok = await this.ari.hangupChannel(call.channelId);
      if (!ok) {
        this.log.warn(`cancelCall: ARI hangup did not confirm for ${call.channelId}; still closing in DB`);
      }
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
