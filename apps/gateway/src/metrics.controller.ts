import { Controller, Get, Header } from "@nestjs/common";
import { register, collectDefaultMetrics } from "prom-client";

collectDefaultMetrics({ register });

@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("Content-Type", register.contentType)
  async metrics() {
    return register.metrics();
  }
}
