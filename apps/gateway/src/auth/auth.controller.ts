import {
  Body,
  Controller,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
  Req,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsString, MinLength } from "class-validator";
import { prisma } from "@crm/db";
import * as bcrypt from "bcryptjs";
import { Request } from "express";
import { JwtAuthGuard } from "./jwt-auth.guard";

class LoginDto {
  @IsString()
  login!: string;

  @IsString()
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

const DEFAULT_LOGIN = process.env.ADMIN_LOGIN ?? "admin";
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD ?? "123456qwerty";
const CONFIG_KEY = "auth.admin";

async function getCredentials(): Promise<{ login: string; passwordHash: string }> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (cfg) {
    return cfg.value as { login: string; passwordHash: string };
  }
  // First run — hash default password and save it
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  await prisma.systemConfig.create({
    data: { key: CONFIG_KEY, value: { login: DEFAULT_LOGIN, passwordHash } },
  });
  return { login: DEFAULT_LOGIN, passwordHash };
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("login")
  async login(@Body() body: LoginDto) {
    const creds = await getCredentials();

    if (body.login.toLowerCase() !== creds.login.toLowerCase()) {
      throw new UnauthorizedException("Неверный логин или пароль");
    }

    const valid = await bcrypt.compare(body.password, creds.passwordHash);
    if (!valid) throw new UnauthorizedException("Неверный логин или пароль");

    const token = this.jwt.sign({ sub: creds.login, role: "admin" });
    return { accessToken: token };
  }

  @UseGuards(JwtAuthGuard)
  @Put("password")
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
  ) {
    void req;
    const creds = await getCredentials();

    const valid = await bcrypt.compare(body.currentPassword, creds.passwordHash);
    if (!valid) throw new UnauthorizedException("Неверный текущий пароль");

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: { login: creds.login, passwordHash } },
      update: { value: { login: creds.login, passwordHash } },
    });

    return { ok: true };
  }
}
