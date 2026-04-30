import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { CallStatus } from "@crm/db";
import { CallsService } from "./calls.service";

@Controller("internal/calls")
export class InternalCallsController {
  constructor(private readonly calls: CallsService) {}

  private guard(secret: string | undefined) {
    const expected = process.env.INTERNAL_API_SECRET ?? "dev-internal-secret";
    if (secret !== expected) throw new UnauthorizedException();
  }

  @Patch(":id/status")
  async status(
    @Headers("x-internal-secret") secret: string,
    @Param("id") id: string,
    @Body() body: { status: CallStatus; recordingKey?: string },
  ) {
    this.guard(secret);
    if (body.status === CallStatus.ENDED || body.status === CallStatus.FAILED) {
      return this.calls.finalizeEnded(id, {
        recordingKey: body.recordingKey,
        failureReason:
          body.status === CallStatus.FAILED ? "voicebot_failed" : undefined,
      });
    }
    return this.calls.transition(id, body.status);
  }

  @Post("inbound")
  async inbound(
    @Headers("x-internal-secret") secret: string,
    @Body() body: { callerPhone: string; promptVersionId?: string },
  ) {
    this.guard(secret);
    return this.calls.createInboundStub(
      body.callerPhone,
      body.promptVersionId,
    );
  }

  @Post(":id/finalize")
  async finalize(
    @Headers("x-internal-secret") secret: string,
    @Param("id") id: string,
    @Body() body: { recordingKey?: string; failureReason?: string },
  ) {
    this.guard(secret);
    return this.calls.finalizeEnded(id, body);
  }

  @Post(":id/transcript")
  async saveTranscript(
    @Headers("x-internal-secret") secret: string,
    @Param("id") id: string,
    @Body() body: { transcript: string },
  ) {
    this.guard(secret);
    return this.calls.saveTranscript(id, body.transcript);
  }
}
