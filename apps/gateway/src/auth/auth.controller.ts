import {
  Body,
  Controller,
  Post,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsString, IsEmail, MinLength } from "class-validator";
import { prisma } from "@crm/db";
import * as bcrypt from "bcryptjs";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;

  @IsString()
  setupKey!: string;
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("login")
  async login(@Body() body: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException("Неверный email или пароль");

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Неверный email или пароль");

    const token = this.jwt.sign({ sub: user.id, role: user.role });
    return {
      accessToken: token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  // First-time setup: creates the first admin user.
  // Only works when no users exist yet OR when SETUP_KEY env matches.
  @Post("setup")
  async setup(@Body() body: RegisterDto) {
    const setupKey = process.env.SETUP_KEY ?? "callcloser-setup";
    if (body.setupKey !== setupKey) {
      throw new UnauthorizedException("Invalid setup key");
    }

    const count = await prisma.user.count();
    if (count > 0) {
      throw new ConflictException("Setup already completed. Use /api/auth/login");
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        name: body.name,
        role: "admin",
      },
    });

    const token = this.jwt.sign({ sub: user.id, role: user.role });
    return {
      accessToken: token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
