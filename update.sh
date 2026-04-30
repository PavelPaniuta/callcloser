#!/bin/bash
# update.sh — pull latest code and restart services
# Run on VPS: bash update.sh
set -e
APP_DIR="/opt/callcloser"
cd "$APP_DIR"

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Running DB migrations..."
cd packages/db && npx prisma migrate deploy && npx prisma generate && cd "$APP_DIR"

echo "Rebuilding web..."
pnpm --filter @crm/web build

echo "Reloading PM2..."
pm2 reload all

echo "✅ Update complete"
