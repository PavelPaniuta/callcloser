import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { Request } from "express";
import { prisma } from "@crm/db";

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method;
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      return next.handle();
    }
    const path = req.path ?? "";
    if (!path.startsWith("/api/")) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void prisma.auditLog
            .create({
              data: {
                action: method,
                resource: path,
                actorId: (req as unknown as { user?: { sub: string } }).user
                  ?.sub,
                payload: {
                  path: req.path,
                },
              },
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}
