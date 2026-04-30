# CRM + Asterisk + on-prem AI (MVP)

Монорепозиторий: **Next.js** UI, **NestJS** gateway и микросервисы (CRM, Calls, Prompt), **VoiceBot** (ARI/Stasis), **analytics-worker** (BullMQ), **Postgres**, **Redis**, **MinIO**, конфиги **Asterisk**.

## Быстрый старт (локально)

1. Скопируйте окружение:

   `copy .env.example .env` (Windows) и при необходимости поправьте значения.

2. Поднимите инфраструктуру:

   `docker compose up -d postgres redis minio asterisk`

3. Примените схему БД и сиды:

   ```bash
   cd packages/db
   npx prisma db push
   npx prisma db seed
   ```

4. Установите зависимости и запустите сервисы (отдельные терминалы):

   ```bash
   npx pnpm@9.14.2 install
   npx pnpm@9.14.2 --filter @crm/db exec prisma generate
   set AUTH_DISABLED=true
   set SIMULATE_CALLS=true
   npx pnpm@9.14.2 --filter @crm/gateway dev
   npx pnpm@9.14.2 --filter @crm/crm-service dev
   npx pnpm@9.14.2 --filter @crm/calls-service dev
   npx pnpm@9.14.2 --filter @crm/prompt-service dev
   npx pnpm@9.14.2 --filter @crm/analytics-worker dev
   npx pnpm@9.14.2 --filter @crm/web dev
   ```

   Без Asterisk оставьте `SIMULATE_CALLS=true`: исходящие звонки завершатся сценарием симуляции, очередь аналитики отработает.

5. UI: http://localhost:3000 — сначала **/login** (dev JWT), затем контакты.

## Asterisk и VoiceBot

- Конфиги: [asterisk/config](asterisk/config). Пользователь ARI: `crm` / `crm_secret_change_me` (смените в проде).
- Stasis-приложение: `crm-voice` (совпадает с `ASTERISK_ARI_APP`).
- **VoiceBot**: `npx pnpm@9.14.2 --filter @crm/voicebot dev` при заданных `ASTERISK_ARI_URL`, `ASTERISK_ARI_PASS`.
- Исходящий endpoint по умолчанию: `PJSIP/{номер}@trunk` — задайте `ASTERISK_OUTBOUND_ENDPOINT` под ваш PJSIP.

## Интеграция ИИ (закрытый контур)

В [apps/voicebot/src/pipeline.ts](apps/voicebot/src/pipeline.ts) и [apps/analytics-worker/src/main.ts](apps/analytics-worker/src/main.ts) предусмотрены заглушки и опциональные HTTP-эндпоинты `ASR_URL`, `LLM_URL`, `TTS_URL` для подключения самохост ASR/LLM/TTS.

## Наблюдаемость и аудит

- Метрики Prometheus: `GET http://localhost:3010/metrics`
- Записи мутаций через gateway пишутся в таблицу `AuditLog` (без тела запроса, только путь).

## Биллинг (заглушка)

Таблица `UsageRecord` пополняется аналитикой (`call_analyzed`). Расширение до тарифов — отдельный этап.

## Retention и секреты

Политики хранения записей/транскриптов и ротация ключей S3 настраиваются на уровне инфраструктуры; в коде хранятся только ключи объектов и presigned URL с коротким TTL.

## Docker Compose (все сервисы)

После `pnpm install` и генерации Prisma на хосте можно собрать образы (`docker compose build`). Для первого запуска удобнее миграции выполнить с хоста (`prisma db push`). В compose добавлены переменные окружения для демо (`AUTH_DISABLED`, `SIMULATE_CALLS`); для продакшена отключите их и включите строгий JWT.
