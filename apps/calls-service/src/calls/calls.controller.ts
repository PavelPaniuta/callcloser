import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { Transform, Type } from "class-transformer";
import { CallsService } from "./calls.service";
import { S3Service } from "./s3.service";
import { CallDirection, CallStatus } from "@crm/db";

/** Strips spaces/punct; keeps leading + for @Matches. */
function normalizePhoneField(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  const hasPlus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

class OutboundDto {
  @Transform(({ value }) => normalizePhoneField(value))
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/)
  phone!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  promptVersionId?: string;

  @IsOptional()
  @IsIn(["asterisk", "vapi"])
  engine?: "asterisk" | "vapi";
}

class CancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class ListQueryDto {
  @IsOptional()
  @IsIn(["CREATED", "QUEUED", "RINGING", "ANSWERED", "ENDED", "FAILED"])
  status?: string;

  @IsOptional()
  @IsIn(["INBOUND", "OUTBOUND"])
  direction?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@Controller("calls")
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly s3: S3Service,
  ) {}

  @Post("outbound")
  outbound(@Body() body: OutboundDto) {
    return this.calls.createOutbound(body);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() body: CancelDto) {
    return this.calls.cancelCall(id, body.reason);
  }

  @Post(":id/retry")
  retry(@Param("id") id: string) {
    return this.calls.retryCall(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.calls.deleteCall(id);
  }

  @Get(":id/recording")
  async recording(@Param("id") id: string) {
    const call = await this.calls.get(id);
    if (!call.recordingObjectKey) return { url: null };
    const url = await this.s3.getPresignedGetUrl(call.recordingObjectKey);
    return { url };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.calls.get(id);
  }

  @Get()
  list(@Query("contactId") contactId?: string, @Query() q?: ListQueryDto) {
    if (contactId) return this.calls.listForContact(contactId);
    if (q?.status || q?.direction || q?.limit) {
      return this.calls.listFiltered({
        status: q.status as CallStatus | undefined,
        direction: q.direction as CallDirection | undefined,
        limit: q.limit,
      });
    }
    return this.calls.listRecent();
  }

  @Delete()
  clear(@Query("contactId") contactId?: string) {
    return this.calls.clearHistory(contactId);
  }
}
