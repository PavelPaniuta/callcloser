import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from "@nestjs/common";
import { CallsService } from "./calls.service";

// VAPI sends these event types
type VapiEvent =
  | { message: { type: "call-start"; call: { id: string; metadata?: Record<string, string> } } }
  | { message: { type: "end-of-call-report"; call: { id: string; metadata?: Record<string, string> }; transcript?: string; summary?: string; recordingUrl?: string } }
  | { message: { type: "hang"; call: { id: string; metadata?: Record<string, string> } } }
  | { message: { type: string; call?: { id?: string; metadata?: Record<string, string> } } };

@Controller("webhooks/vapi")
export class VapiWebhookController {
  private readonly log = new Logger(VapiWebhookController.name);

  constructor(private readonly calls: CallsService) {}

  @Post()
  async handle(
    @Body() body: VapiEvent,
    @Headers("x-vapi-secret") secret?: string,
  ) {
    // Optional webhook secret validation
    const expected = process.env.VAPI_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new UnauthorizedException("Invalid webhook secret");
    }

    const msg = body?.message;
    if (!msg) return { ok: true };

    const vapiCallId = msg.call?.id;
    const crm_call_id = msg.call?.metadata?.crm_call_id;

    this.log.log(`VAPI webhook type=${msg.type} vapiCallId=${vapiCallId} crmCallId=${crm_call_id}`);

    switch (msg.type) {
      case "call-start": {
        if (crm_call_id) {
          await this.calls.transition(crm_call_id, "ANSWERED" as never).catch(() => undefined);
        }
        break;
      }

      case "end-of-call-report": {
        if (crm_call_id) {
          const report = msg as Extract<VapiEvent, { message: { type: "end-of-call-report" } }>["message"];
          // Save transcript from VAPI before finalizing
          if (report.transcript) {
            await this.calls.saveTranscript(crm_call_id, report.transcript).catch(() => undefined);
          }
          await this.calls.finalizeEnded(crm_call_id, {
            recordingKey: report.recordingUrl ?? undefined,
          }).catch(() => undefined);
        }
        break;
      }

      case "hang": {
        if (crm_call_id) {
          await this.calls.finalizeEnded(crm_call_id, {
            failureReason: "VAPI_HANG",
          }).catch(() => undefined);
        }
        break;
      }

      default:
        break;
    }

    return { ok: true };
  }
}
