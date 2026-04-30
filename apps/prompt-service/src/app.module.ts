import { Module } from "@nestjs/common";
import { PromptsModule } from "./prompts/prompts.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [PromptsModule],
  controllers: [HealthController],
})
export class AppModule {}
