#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# One-time provisioning for the PROD server (silversea.tingting.vip).
#
# Run via `make deploy-server-setup`. Idempotent: re-running refreshes repo-
# owned files (compose, vhost) and hardening, but NEVER regenerates existing
# secrets (.env is created only if missing). Data volumes are never touched.
#
# What it does:
#   1.  Reachability + DNS sanity
#   2.  Docker + compose plugin
#   3.  /opt/silversea layout
#   4.  Secrets: fresh JWT_SECRET / DB_PASSWORD / SETTINGS_ENCRYPTION_KEY,
#       shared keys mirrored from the demo .env (Maps/VAPID)
#   5.  Repo compose pushed to the server
#   6.  nginx + certbot install
#   7.  Bootstrap vhost → Let's Encrypt cert (webroot HTTP-01)
#   8.  Full prod vhost (no public adminer — SSH tunnel only)
#   9.  Certbot auto-renew: certbot.timer + reload deploy hook + dry-run proof
#   10. Hardening: ufw (22/80/443 only), SSH key-only, unattended upgrades,
#       server_tokens off
#   11. Start postgres + redis (backend/frontend come with `make deploy`)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="root@silversea.tingting.vip"
DEMO_SERVER="root@vantai.tingting.vip"
BASE="/opt/silversea"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VHOST_SRC="$REPO/deploy/nginx-host-silversea.conf"

step() { printf '\n=== %s ===\n' "$1"; }

cd "$(mktemp -d)"  # scratch dir for generated secrets
trap 'rm -rf "$(pwd)"' EXIT

step "1/11  Reachability + DNS"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$SERVER" 'echo "SSH OK: $(hostname)"'
SERVER_IPS="$(ssh "$SERVER" 'hostname -I')"
DNS_IP="$(dig +short silversea.tingting.vip | tail -1)"
case " $SERVER_IPS " in
  *" $DNS_IP "*) ;;
  *) echo "❌ DNS mismatch: silversea.tingting.vip=$DNS_IP but server reports:$SERVER_IPS" >&2; exit 1 ;;
esac
echo "DNS OK: silversea.tingting.vip -> $DNS_IP"

step "2/11  Docker + compose plugin"
ssh "$SERVER" 'command -v docker >/dev/null 2>&1 || { curl -fsSL https://get.docker.com | sh; }; systemctl enable --now docker; docker compose version'

step "3/11  /opt/silversea layout"
ssh "$SERVER" "mkdir -p $BASE/deploy $BASE/data/postgres $BASE/data/redis $BASE/data/uploads"

step "4/11  Secrets (.env) — create only if missing"
ENV_PRESENT=$(ssh "$SERVER" "test -f $BASE/deploy/.env && echo present || echo missing")
if [ "$ENV_PRESENT" = "missing" ]; then
  echo "Generating fresh secrets (never printed)..."
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  DB_PASSWORD="$(openssl rand -hex 24)"
  SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  echo "Mirroring shared keys from the demo .env (values never displayed)..."
  DEMO_KEYS='GOOGLE_MAPS_API_KEY|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT|OPENROUTER_API_KEY'
  ssh "$DEMO_SERVER" "grep -E '^($DEMO_KEYS)=' /opt/vantai/deploy/.env" > demo-keys.env || true
  MISSING_DEMO_KEYS=""
  for k in $(echo "$DEMO_KEYS" | tr '|' ' '); do
    grep -q "^$k=" demo-keys.env || MISSING_DEMO_KEYS="$MISSING_DEMO_KEYS $k"
  done
  if [ -n "$MISSING_DEMO_KEYS" ]; then
    echo "⚠️  Demo .env lacks:$MISSING_DEMO_KEYS — absent on prod; backend may warn." >&2
  fi
  {
    echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by deploy/setup-silversea-server.sh"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "JWT_EXPIRES_IN=7d"
    echo "DB_PASSWORD=$DB_PASSWORD"
    echo "SETTINGS_ENCRYPTION_KEY=$SETTINGS_ENCRYPTION_KEY"
    echo "LOG_LEVEL=info"
    cat demo-keys.env
  } > prod.env
  scp -q prod.env "$SERVER:$BASE/deploy/.env"
  ssh "$SERVER" "chmod 600 $BASE/deploy/.env"
  echo "✅ .env created (600, root-only)"
else
  echo ".env already present — left untouched"
fi

step "5/11  Push compose file"
scp -q "$REPO/deploy/docker-compose.silversea.yml" "$SERVER:$BASE/deploy/docker-compose.silversea.yml"
echo "compose pushed"

step "6/11  nginx + certbot"
ssh "$SERVER" 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null; mkdir -p /var/www/certbot
# The webroot flow never copies the plugin TLS configs into /etc/letsencrypt — do it explicitly.
if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
  cp /usr/lib/python3/dist-packages/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf /etc/letsencrypt/
fi
if [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  cp /usr/lib/python3/dist-packages/certbot/ssl-dhparams.pem /etc/letsencrypt/
fi
nginx -v'

step "7/11  TLS certificate (webroot HTTP-01, skip if present)"
CERT_PRESENT=$(ssh "$SERVER" "test -d /etc/letsencrypt/live/silversea.tingting.vip && echo present || echo missing")
if [ "$CERT_PRESENT" = "missing" ]; then
  cat > bootstrap-vhost.conf <<'BOOTSTRAP'
# Bootstrap vhost: port 80 only — enough for the ACME webroot challenge.
server {
    listen 80;
    listen [::]:80;
    server_name silversea.tingting.vip;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
BOOTSTRAP
  scp -q bootstrap-vhost.conf "$SERVER:/etc/nginx/sites-available/silversea"
  ssh "$SERVER" 'ln -sfn /etc/nginx/sites-available/silversea /etc/nginx/sites-enabled/silversea; nginx -t && systemctl reload nginx'
  CERTBOT_EMAIL="${CERTBOT_EMAIL:-frankng.sg@gmail.com}"
  echo "Issuing certificate (account email: $CERTBOT_EMAIL)..."
  ssh "$SERVER" "certbot certonly --webroot -w /var/www/certbot -d silversea.tingting.vip --non-interactive --agree-tos -m '$CERTBOT_EMAIL' --no-eff-email"
else
  echo "Cert already present — skipping issuance"
fi

step "8/11  Full prod vhost"
scp -q "$VHOST_SRC" "$SERVER:/etc/nginx/sites-available/silversea"
ssh "$SERVER" 'ln -sfn /etc/nginx/sites-available/silversea /etc/nginx/sites-enabled/silversea; nginx -t && systemctl reload nginx'
echo "vhost pushed + reloaded"

step "9/11  Certbot auto-renew (timer + reload hook + dry-run proof)"
cat > reload-nginx-hook.sh <<'HOOK'
#!/bin/sh
# Runs after every successful certbot renewal: validate + reload nginx.
nginx -t && systemctl reload nginx
HOOK
scp -q reload-nginx-hook.sh "$SERVER:/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh"
ssh "$SERVER" 'chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh; systemctl enable --now certbot.timer; systemctl is-active certbot.timer'
ssh "$SERVER" 'echo "Running certbot renew --dry-run (staging ACME, proves webroot + hook)..."; certbot renew --dry-run --non-interactive'

step "10/11  Hardening"
ssh "$SERVER" 'set -e
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq ufw unattended-upgrades >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<SSHEOF
PasswordAuthentication no
PermitRootLogin prohibit-password
SSHEOF
sshd -t && systemctl reload ssh
systemctl enable --now unattended-upgrades
echo "server_tokens off;" > /etc/nginx/conf.d/99-hardening.conf
nginx -t && systemctl reload nginx
echo "hardening applied"'

echo "Verifying SSH still works after sshd hardening..."
ssh -o ConnectTimeout=10 -o BatchMode=yes "$SERVER" 'echo "SSH post-hardening: OK"'

step "11/11  Start postgres + redis"
ssh "$SERVER" "cd $BASE && docker compose -f deploy/docker-compose.silversea.yml up -d postgres redis"
ssh "$SERVER" "sleep 3; cd $BASE && docker compose -f deploy/docker-compose.silversea.yml ps --format '{{.Name}}|{{.Status}}'"

echo ""
echo "✅ Server ready. Next: make deploy  ->  https://silversea.tingting.vip"
