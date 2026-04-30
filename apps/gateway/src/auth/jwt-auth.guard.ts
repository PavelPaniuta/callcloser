import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? req.url?.split("?")[0] ?? "";

    if (path.startsWith("/health")) return true;
    if (path.startsWith("/metrics")) return true;
    if (path.startsWith("/api/auth")) return true;

    if (process.env.AUTH_DISABLED === "true") {
      (req as unknown as { user: { sub: string; role: string } }).user = {
        sub: "dev",
        role: "admin",
      };
      return true;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer "))
      throw new UnauthorizedException("Missing bearer token");

    const token = auth.slice(7);
    try {
      const payload = this.jwt.verify<{ sub: string; role: string }>(token);
      (req as unknown as { user: typeof payload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
