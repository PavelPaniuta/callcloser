import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  IntegrationType,
  RoutingAction,
  RoutingDirection,
} from "@crm/db";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Request } from "express";
import { SettingsService } from "./settings.service";

class ProviderDto {
  @IsString()
  name!: string;

  @IsEnum(IntegrationType)
  type!: IntegrationType;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  secret?: string;
}

class UpdateProviderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  secret?: string;
}

class SipTrunkDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  providerId!: string;

  @IsString()
  endpointName!: string;

  @IsString()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  fromDomain?: string;

  @IsOptional()
  @IsString()
  outboundProxy?: string;

  @IsOptional()
  @IsArray()
  didNumbers?: string[];

  @IsOptional()
  @IsArray()
  codecs?: string[];

  @IsOptional()
  @IsString()
  transport?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class RoutingRuleDto {
  @IsEnum(RoutingDirection)
  direction!: RoutingDirection;

  @IsString()
  matchExpr!: string;

  @IsEnum(RoutingAction)
  action!: RoutingAction;

  @IsString()
  target!: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

class RoutingRulePatchDto {
  @IsOptional()
  @IsEnum(RoutingDirection)
  direction?: RoutingDirection;

  @IsOptional()
  @IsString()
  matchExpr?: string;

  @IsOptional()
  @IsEnum(RoutingAction)
  action?: RoutingAction;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

class SystemConfigDto {
  @IsString()
  key!: string;

  @IsObject()
  value!: Record<string, unknown>;
}

type UserReq = Request & { user?: { sub?: string; role?: string } };

@Controller("api/settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  private ensureAdmin(req: UserReq) {
    if (req.user?.role !== "admin") {
      throw new ForbiddenException("admin role required");
    }
  }

  @Get("integrations")
  listProviders() {
    return this.settings.listProviders();
  }

  @Post("integrations")
  createProvider(@Req() req: UserReq, @Body() body: ProviderDto) {
    this.ensureAdmin(req);
    return this.settings.createProvider(body);
  }

  @Patch("integrations/:id")
  updateProvider(
    @Req() req: UserReq,
    @Param("id") id: string,
    @Body() body: UpdateProviderDto,
  ) {
    this.ensureAdmin(req);
    return this.settings.updateProvider(id, body);
  }

  @Delete("integrations/:id")
  deleteProvider(@Req() req: UserReq, @Param("id") id: string) {
    this.ensureAdmin(req);
    return this.settings.deleteProvider(id);
  }

  @Post("integrations/:id/activate")
  activateProvider(@Req() req: UserReq, @Param("id") id: string) {
    this.ensureAdmin(req);
    return this.settings.activateProvider(id);
  }

  @Post("integrations/:id/test")
  testProvider(@Req() req: UserReq, @Param("id") id: string) {
    this.ensureAdmin(req);
    return this.settings.testProvider(id);
  }

  @Get("sip-trunks")
  listSipTrunks() {
    return this.settings.listSipTrunks();
  }

  @Post("sip-trunks")
  upsertSipTrunk(@Req() req: UserReq, @Body() body: SipTrunkDto) {
    this.ensureAdmin(req);
    return this.settings.upsertSipTrunk(body);
  }

  @Delete("sip-trunks/:id")
  deleteSipTrunk(@Req() req: UserReq, @Param("id") id: string) {
    this.ensureAdmin(req);
    return this.settings.deleteSipTrunk(id);
  }

  @Get("routing-rules")
  listRoutingRules() {
    return this.settings.listRoutingRules();
  }

  @Post("routing-rules")
  createRoutingRule(@Req() req: UserReq, @Body() body: RoutingRuleDto) {
    this.ensureAdmin(req);
    return this.settings.createRoutingRule(body);
  }

  @Patch("routing-rules/:id")
  updateRoutingRule(
    @Req() req: UserReq,
    @Param("id") id: string,
    @Body() body: RoutingRulePatchDto,
  ) {
    this.ensureAdmin(req);
    return this.settings.updateRoutingRule(id, body);
  }

  @Delete("routing-rules/:id")
  deleteRoutingRule(@Req() req: UserReq, @Param("id") id: string) {
    this.ensureAdmin(req);
    return this.settings.deleteRoutingRule(id);
  }

  @Get("system-config")
  listSystemConfig() {
    return this.settings.listSystemConfig();
  }

  @Post("system-config")
  setSystemConfig(@Req() req: UserReq, @Body() body: SystemConfigDto) {
    this.ensureAdmin(req);
    return this.settings.setSystemConfig(body.key, body.value);
  }

  @Get("revisions")
  listRevisions() {
    return this.settings.listRevisions();
  }

  // ── VAPI convenience endpoints ─────────────────────────────────────────

  @Get("vapi/config")
  getVapiConfig() {
    return this.settings.getVapiConfig();
  }

  @Post("vapi/config")
  saveVapiConfig(@Req() req: UserReq, @Body() body: Record<string, string>) {
    this.ensureAdmin(req);
    return this.settings.saveVapiConfig(body);
  }

  @Post("vapi/test")
  async testVapi(@Req() req: UserReq) {
    this.ensureAdmin(req);
    return this.settings.testVapiConnection();
  }

  @Post("config/apply")
  apply(@Req() req: UserReq) {
    this.ensureAdmin(req);
    return this.settings.applyConfig(req.user?.sub);
  }

  @Post("config/rollback/:revisionId")
  rollback(@Req() req: UserReq, @Param("revisionId") revisionId: string) {
    this.ensureAdmin(req);
    return this.settings.rollbackConfig(revisionId, req.user?.sub);
  }
}
