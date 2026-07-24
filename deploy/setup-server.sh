#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# TingTing — DigitalOcean Droplet one-time setup
#
# Usage:  ssh root@nepo.tingting.vip 'bash -s' < deploy/setup-server.sh
#
# After this script completes:
#   1. make push && make deploy   (from local machine)
#   2. make adminer               (optional, private DB GUI over SSH tunnel)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "=== TingTing Server Setup ==="
echo ""

# ── 1. Update System ─────────────────────────────────────────────────────────
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# ── 2. Install Docker ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "🐳 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# ── 3. Install Nginx & Certbot ───────────────────────────────────────────────
echo "🌐 Installing Nginx and Certbot..."
apt install -y nginx certbot python3-certbot-nginx

# ── 4. Configure Firewall (UFW) ─────────────────────────────────────────────
echo "🔥 Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "✅ Firewall configured (SSH + HTTP + HTTPS only)"

# ── 5. Create Directory Structure ────────────────────────────────────────────
echo "📁 Creating directory structure..."
mkdir -p /opt/nepocorp/data/postgres
mkdir -p /opt/nepocorp/data/redis
mkdir -p /opt/nepocorp/data/uploads
mkdir -p /opt/nepocorp/deploy
mkdir -p /var/www/certbot
echo "✅ Directories created"

# ── 6. Generate Secrets ──────────────────────────────────────────────────────
JWT_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 24 | tr '+/' '-_')

echo "🔑 Generating secrets..."

cat > /opt/nepocorp/deploy/.env << EOF
# Auth
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

# Database
DB_PASSWORD=${DB_PASSWORD}

# Google Maps
GOOGLE_MAPS_API_KEY=
EOF

chmod 600 /opt/nepocorp/deploy/.env
echo "✅ Secrets generated and saved to /opt/nepocorp/deploy/.env"

# ── 7. Write Nginx Config ────────────────────────────────────────────────────
echo "📝 Writing Nginx configuration..."
cat > /etc/nginx/sites-available/tingting << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name nepo.tingting.vip;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /uploads/ {
        alias /opt/nepocorp/data/uploads/;
        expires 30d;
        add_header Cache-Control "public";
        add_header X-Content-Type-Options "nosniff" always;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:3090;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
        client_max_body_size 20m;
    }

    # socket.io — the command-and-insight assistant transport (/agent
    # namespace, path /socket.io). Must reach the backend (3090), not the
    # frontend SPA. WebSocket upgrade + long read timeout for multi-tool turns.
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:3090;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX

# Enable site
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/tingting /etc/nginx/sites-enabled/
nginx -t && systemctl enable nginx && systemctl restart nginx
echo "✅ Nginx configured"

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  ✅ Server setup complete!"
echo "=========================================="
echo ""
echo "Next steps from your LOCAL machine:"
echo ""
echo "  1. Push images:"
echo "     make push"
echo ""
echo "  2. Deploy to droplet:"
echo "     make deploy"
echo ""
echo "  3. Enable SSL (first time only):"
echo "     ssh root@nepo.tingting.vip 'certbot --nginx -d nepo.tingting.vip'"
echo ""
echo "  4. (Optional) Open Adminer (private SSH tunnel):"
echo "     make adminer"
echo ""
echo "  5. Test login:"
echo "     https://nepo.tingting.vip"
echo "     Username: admin  Password: admin123"
echo ""
echo "Generated secrets saved to: /opt/nepocorp/deploy/.env"
