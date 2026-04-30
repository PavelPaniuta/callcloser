import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { CallsModule } from "./calls/calls.module";
import { HealthController } from "./health.controller";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: redisUrl },
    }),
    CallsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
