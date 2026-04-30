import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";
import { AriService } from "./ari.service";
import { S3Service } from "./s3.service";
import { VapiService } from "./vapi.service";
import { VapiWebhookController } from "./vapi-webhook.controller";
import { InternalCallsController } from "./internal-calls.controller";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "call-ended",
    }),
  ],
  controllers: [CallsController, InternalCallsController, VapiWebhookController],
  providers: [CallsService, AriService, S3Service, VapiService],
  exports: [CallsService],
})
export class CallsModule {}
