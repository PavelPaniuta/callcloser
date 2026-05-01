#!/bin/bash
# update.sh — pull latest code, DB push, rebuild, PM2 reload
# На VPS: export APP_DIR=/opt/callcloser  # за потреби
#         bash "$APP_DIR/update.sh"
set -e
APP_DIR="${APP_DIR:-/opt/callcloser}"
cd "$APP_DIR"
export APP_DIR

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Loading env..."
set -a; source "$APP_DIR/.env"; set +a

echo "Applying DB schema..."
cd packages/db
npx prisma db push --accept-data-loss
npx prisma generate
cd "$APP_DIR"

echo "Building all packages..."
pnpm run build

echo "Reloading PM2..."
pm2 reload all

pm2 status

echo "✅ Update complete"
echo "Tip: Asterisk за замовчуванням вимкнено (profile asterisk). На сервері: docker compose up -d"
echo "Tip: з профілем Asterisk: docker compose --profile asterisk up -d"
echo "Tip: після змін asterisk/config (якщо контейнер піднятий):"
echo "  cd $APP_DIR && docker compose exec -T asterisk asterisk -rx \"dialplan reload\" && docker compose exec -T asterisk asterisk -rx \"pjsip reload\""
