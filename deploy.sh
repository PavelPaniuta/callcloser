#!/bin/bash
# ============================================================
# deploy.sh — full VPS setup (Docker: Postgres/Redis/Minio/Asterisk + PM2 apps + Nginx)
#
# На чистом Ubuntu 22.04/24.04 от root:
#   export DEPLOY_REPO="https://github.com/you/your-fork.git"   # опционально
#   export APP_DIR="/opt/callcloser"                             # опционально
#   export DOMAIN="yourdomain.com"                               # ваш домен (DNS → IP VPS)
#   export CERTBOT_EMAIL="you@example.com"                       # для Let's Encrypt
#   bash deploy.sh
#
# Перед запуском: скопируйте .env.example → /opt/callcloser/.env (или $APP_DIR/.env)
#   DATABASE_URL=postgresql://crm:crm@127.0.0.1:5433/crm?schema=public
#   REDIS_URL=redis://127.0.0.1:6379
#   S3_ENDPOINT=http://127.0.0.1:9000
#   ASTERISK_ARI_URL=http://127.0.0.1:8088/ari
#   Укажите пароли Postgres/MinIO как в docker-compose (по умолчанию user crm / crm).
#   В asterisk/config/pjsip.conf — external_media_address / external_signaling_address = публичный IP VPS.
# ============================================================
set -e

REPO="${DEPLOY_REPO:-https://github.com/PavelPaniuta/callcloser.git}"
APP_DIR="${APP_DIR:-/opt/callcloser}"
DOMAIN="${DOMAIN:-callcloser.live}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"
NODE_VERSION="${NODE_VERSION:-22}"

echo "=============================="
echo " VPS deploy — $APP_DIR"
echo " Domain: $DOMAIN"
echo " Repo:   $REPO"
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
  mkdir -p "$(dirname "$APP_DIR")"
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

# ── 8. Docker infrastructure (Postgres має бути до prisma db push) ───────────
echo "Starting Docker services..."
docker compose up -d postgres redis minio minio-init asterisk

echo "Waiting for Postgres..."
for i in {1..30}; do
  docker compose exec -T postgres pg_isready -U crm &>/dev/null && break
  sleep 2
done

# ── 9. DB schema (немає prisma/migrations — db push) ────────────────────────
echo "Applying Prisma schema..."
cd "$APP_DIR/packages/db"
set -a; source "$APP_DIR/.env"; set +a
npx prisma db push --accept-data-loss
npx prisma generate
cd "$APP_DIR"

# ── 10. Build all workspace packages ─────────────────────────
echo "Building all apps (pnpm run build)..."
set -a; source "$APP_DIR/.env"; set +a
pnpm run build

# ── 11. PM2 ───────────────────────────────────────────────────
echo "Starting PM2 services..."
export APP_DIR
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

# ── 12. Nginx (без SSL до certbot, інакше nginx -t падає) ─────
install_full_nginx() {
  sed -e "s/callcloser.live/${DOMAIN}/g" nginx.conf > /etc/nginx/sites-available/callcloser
}
install_bootstrap_nginx() {
  sed -e "s/callcloser.live/${DOMAIN}/g" nginx.bootstrap.conf > /etc/nginx/sites-available/callcloser
}
echo "Configuring Nginx for $DOMAIN..."
LE_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -f "$LE_CERT" ]; then
  install_full_nginx
else
  install_bootstrap_nginx
fi
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
echo "Getting SSL certificate (email: $CERTBOT_EMAIL)..."
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL"; then
  if [ -f "$LE_CERT" ]; then
    echo "Installing production Nginx config (HTTPS)..."
    install_full_nginx
    nginx -t && systemctl reload nginx
  fi
else
  echo "⚠️  SSL failed — DNS A/AAAA для $DOMAIN та www.$DOMAIN на цей VPS, потім:"
  echo "    certbot --nginx -d $DOMAIN -d www.$DOMAIN"
  echo "    Після успіху: sed -e \"s/callcloser.live/${DOMAIN}/g\" $APP_DIR/nginx.conf | sudo tee /etc/nginx/sites-available/callcloser && sudo nginx -t && sudo systemctl reload nginx"
fi

echo ""
echo "=============================="
echo " ✅ Deployment complete!"
echo " 🌍 https://$DOMAIN"
echo " 📊 pm2 status | pm2 logs"
echo " 🔄 Updates: bash $APP_DIR/update.sh"
echo " SIMULATE_CALLS=false в .env для реальных исходящих через Asterisk."
echo "=============================="
