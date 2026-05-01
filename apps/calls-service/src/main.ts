import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

/** PM2 env_file can skip lines (e.g. values starting with +). Fill missing process.env from repo .env. */
function mergeRootEnv() {
  const p = resolve(__dirname, "../../../.env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const broken = process.env.ASTERISK_OUTBOUND_ENDPOINT;
  if (broken && broken.includes("PJSIP/@")) delete process.env.ASTERISK_OUTBOUND_ENDPOINT;
}
mergeRootEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.CALLS_PORT ?? 3012;
  await app.listen(port);
  console.log(`Calls service http://localhost:${port}`);
}

bootstrap();
