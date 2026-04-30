import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { JwtModule } from "@nestjs/jwt";
import {
  CallsProxyController,
  CompaniesProxyController,
  ContactsProxyController,
  PromptsProxyController,
  RecordingsProxyController,
} from "./proxy/proxy.controller";
import { AuthController } from "./auth/auth.controller";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { APP_GUARD } from "@nestjs/core";
import { EventsGateway } from "./events/events.gateway";
import { HealthController } from "./health.controller";
import { MetricsController } from "./metrics.controller";
import { AuditInterceptor } from "./audit/audit.interceptor";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { AdminController } from "./admin/admin.controller";
import { CampaignRunnerService } from "./admin/campaign-runner.service";

@Module({
  imports: [
    HttpModule.register({ timeout: 30000, maxRedirects: 3 }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-only-change-in-production-min-32-chars!!",
      signOptions: { expiresIn: "12h" },
    }),
  ],
  controllers: [
    ContactsProxyController,
    CompaniesProxyController,
    CallsProxyController,
    PromptsProxyController,
    RecordingsProxyController,
    AuthController,
    SettingsController,
    AdminController,
    HealthController,
    MetricsController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    EventsGateway,
    SettingsService,
    CampaignRunnerService,
  ],
})
export class AppModule {}
