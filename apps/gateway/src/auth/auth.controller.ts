import { Body, Controller, Post } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsString } from "class-validator";

class DevLoginDto {
  @IsString()
  userId!: string;
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("dev-login")
  devLogin(@Body() body: DevLoginDto) {
    const token = this.jwt.sign({
      sub: body.userId,
      role: "admin",
    });
    return { accessToken: token };
  }
}
