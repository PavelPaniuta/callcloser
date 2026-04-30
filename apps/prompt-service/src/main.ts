import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PROMPT_PORT ?? 3013;
  await app.listen(port);
  console.log(`Prompt service http://localhost:${port}`);
}

bootstrap();
