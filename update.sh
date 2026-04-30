#!/bin/bash
# update.sh — pull latest code and restart services
# Run on VPS: bash /opt/callcloser/update.sh
set -e
APP_DIR="/opt/callcloser"
cd "$APP_DIR"

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Loading env..."
set -a; source "$APP_DIR/.env"; set +a

echo "Applying DB schema changes..."
cd packages/db
npx prisma db push --accept-data-loss
npx prisma generate
cd "$APP_DIR"

echo "Rebuilding gateway..."
pnpm --filter @crm/gateway build

echo "Rebuilding analytics-worker..."
pnpm --filter @crm/analytics-worker build

echo "Rebuilding web..."
pnpm --filter @crm/web build

echo "Reloading PM2..."
pm2 reload all

pm2 status

echo "✅ Update complete"
