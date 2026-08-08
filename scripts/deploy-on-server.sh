#!/bin/bash
# Build directly on the demo server (AMD64) to bypass QEMU crashes

set -e

SERVER="root@vantai.tingting.vip"
REPO_PATH="/opt/vantai"
REPO_URL="git@github.com:4rankng/silversea.git"

echo "=== Deploying silversea to $SERVER ==="
echo ""

# SSH to server and pull/build
ssh "$SERVER" << 'ENDSSH'
cd /opt/vantai || { echo "Path not found"; exit 1; }
git pull origin main
cd backend && make push
cd ../frontend && make push
ENDSSH

echo ""
echo "✅ Images built on server (AMD64, no QEMU)"
echo "Deploy with: ssh root@vantai.tingting.vip 'cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate backend frontend'"
