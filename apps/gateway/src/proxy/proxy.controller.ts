import { All, Controller, Get, Param, Req, Res } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { Request, Response } from "express";
import { firstValueFrom } from "rxjs";

const CRM = () => process.env.CRM_SERVICE_URL ?? "http://localhost:3011";
const CALLS = () => process.env.CALLS_SERVICE_URL ?? "http://localhost:3012";
const PROMPT = () => process.env.PROMPT_SERVICE_URL ?? "http://localhost:3013";

@Controller("api/contacts")
export class ContactsProxyController {
  constructor(private readonly http: HttpService) {}

  @All()
  async root(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CRM(), req, res, "/contacts");
  }

  @All("*")
  async all(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CRM(), req, res, "/contacts");
  }
}

@Controller("api/companies")
export class CompaniesProxyController {
  constructor(private readonly http: HttpService) {}

  @All()
  async root(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CRM(), req, res, "/companies");
  }

  @All("*")
  async all(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CRM(), req, res, "/companies");
  }
}

@Controller("api/calls")
export class CallsProxyController {
  constructor(private readonly http: HttpService) {}

  @All()
  async root(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CALLS(), req, res, "/calls");
  }

  @All("*")
  async all(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, CALLS(), req, res, "/calls");
  }
}

@Controller("api/prompts")
export class PromptsProxyController {
  constructor(private readonly http: HttpService) {}

  @All()
  async root(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, PROMPT(), req, res, "/prompts");
  }

  @All("*")
  async all(@Req() req: Request, @Res() res: Response) {
    await forward(this.http, PROMPT(), req, res, "/prompts");
  }
}

@Controller("api/recordings")
export class RecordingsProxyController {
  constructor(private readonly http: HttpService) {}

  @Get(":callId/url")
  async url(@Param("callId") callId: string, @Res() res: Response) {
    const r = await firstValueFrom(
      this.http.get(`${CALLS()}/calls/${callId}/recording`, {
        validateStatus: () => true,
      }),
    );
    res.status(r.status).json(r.data);
  }
}

async function forward(
  http: HttpService,
  base: string,
  req: Request,
  res: Response,
  upstreamPrefix: string,
) {
  const u = new URL(req.originalUrl, "http://localhost");
  const stripped = u.pathname.replace(/^\/api\/(contacts|companies|calls|prompts)/, "");
  const path = `${upstreamPrefix}${stripped === "" ? "" : stripped}`;
  const url = `${base}${path}${u.search}`;
  const method = req.method.toLowerCase() as
    | "get"
    | "post"
    | "patch"
    | "put"
    | "delete";

  const out = await firstValueFrom(
    http.request({
      url,
      method,
      headers: {
        "content-type": req.headers["content-type"] ?? "application/json",
      },
      data: ["post", "patch", "put"].includes(method) ? req.body : undefined,
      validateStatus: () => true,
    }),
  );
  res.status(out.status).json(out.data);
}
