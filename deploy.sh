#!/bin/bash
# ============================================================
# deploy.sh — full VPS setup for callcloser.live
# Run once as root on a fresh Ubuntu 22.04 VPS:
#   bash deploy.sh
# ============================================================
set -e

REPO="https://github.com/PavelPaniuta/callcloser.git"
APP_DIR="/opt/callcloser"
DOMAIN="callcloser.live"
NODE_VERSION="22"

echo "=============================="
echo " CallCloser VPS Setup"
echo "=============================="

# ── 1. System packages ──────────────────────────────────────
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ffmpeg ufw

# ── 2. Node.js ──────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js $NODE_VERSION..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node -v)"

# ── 3. pnpm + PM2 ───────────────────────────────────────────
npm install -g pnpm@9.14.2 pm2 --quiet
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ── 4. Docker ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
echo "Docker: $(docker --version)"

# ── 5. Clone / pull repo ─────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  echo "Pulling latest code..."
  git -C "$APP_DIR" pull
else
  echo "Cloning repo..."
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 6. .env file ─────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "⚠️  Create $APP_DIR/.env before continuing!"
  echo "   Copy .env.example and fill in your secrets."
  echo "   Then re-run: bash deploy.sh"
  exit 1
fi

# ── 7. Install dependencies ───────────────────────────────────
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# ── 8. DB migrate + generate ─────────────────────────────────
echo "Running DB migrations..."
cd packages/db
npx prisma migrate deploy
npx prisma generate
cd "$APP_DIR"

# ── 9. Build all apps ─────────────────────────────────────────
echo "Building apps..."
pnpm --filter @crm/web build
pnpm --filter @crm/gateway build 2>/dev/null || true
pnpm --filter @crm/calls-service build 2>/dev/null || true
pnpm --filter @crm/crm-service build 2>/dev/null || true
pnpm --filter @crm/prompt-service build 2>/dev/null || true

# ── 10. Docker infrastructure ─────────────────────────────────
echo "Starting Docker services..."
docker compose up -d postgres redis minio asterisk

# Wait for Postgres to be ready
echo "Waiting for Postgres..."
for i in {1..30}; do
  docker compose exec -T postgres pg_isready -U crm &>/dev/null && break
  sleep 2
done

# ── 11. PM2 ───────────────────────────────────────────────────
echo "Starting PM2 services..."
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

# ── 12. Nginx ─────────────────────────────────────────────────
echo "Configuring Nginx..."
cp nginx.conf /etc/nginx/sites-available/callcloser
ln -sf /etc/nginx/sites-available/callcloser /etc/nginx/sites-enabled/callcloser
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 13. Firewall ──────────────────────────────────────────────
echo "Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 5060/udp comment "SIP"
ufw allow 10000:10100/udp comment "RTP media"
ufw --force enable

# ── 14. SSL ────────────────────────────────────────────────────
echo ""
echo "Getting SSL certificate..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m admin@"$DOMAIN" || \
  echo "⚠️  SSL failed — make sure DNS points to this server first"

echo ""
echo "=============================="
echo " ✅ Deployment complete!"
echo " 🌍 https://$DOMAIN"
echo " 📊 pm2 status"
echo " 📋 pm2 logs"
echo "=============================="
