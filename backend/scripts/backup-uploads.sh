#!/usr/bin/env bash
# T4.9: Nightly backup for UPLOAD_DIR volume
#
# Backs up the uploads directory and database to a timestamped archive.
# Designed to run via cron: 0 2 * * * /path/to/backup-uploads.sh
#
# Environment:
#   UPLOAD_DIR   — path to uploads directory (default: ./uploads)
#   BACKUP_DIR   — where backups are stored (default: ./backups)
#   DATABASE_URL — Postgres connection string
#   RETENTION_DAYS — how many days of backups to keep (default: 30)

set -euo pipefail

UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/tingting}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

echo "[$(date)] Starting backup..."

# Create backup directory
mkdir -p "${BACKUP_PATH}"

# 1. Backup uploads directory
if [ -d "${UPLOAD_DIR}" ]; then
  echo "  Backing up uploads from ${UPLOAD_DIR}..."
  tar -czf "${BACKUP_PATH}/uploads.tar.gz" -C "$(dirname "${UPLOAD_DIR}")" "$(basename "${UPLOAD_DIR}")"
  UPLOAD_SIZE=$(du -sh "${BACKUP_PATH}/uploads.tar.gz" | cut -f1)
  echo "  Uploads backup: ${UPLOAD_SIZE}"
else
  echo "  WARNING: UPLOAD_DIR '${UPLOAD_DIR}' does not exist, skipping."
fi

# 2. Backup database (pg_dump)
if command -v pg_dump &>/dev/null; then
  echo "  Backing up database..."
  pg_dump "${DATABASE_URL}" --no-owner --no-acl | gzip > "${BACKUP_PATH}/database.sql.gz"
  DB_SIZE=$(du -sh "${BACKUP_PATH}/database.sql.gz" | cut -f1)
  echo "  Database backup: ${DB_SIZE}"
else
  echo "  WARNING: pg_dump not found, database backup skipped."
fi

# 3. Create manifest
cat > "${BACKUP_PATH}/manifest.json" << EOF
{
  "timestamp": "${TIMESTAMP}",
  "date": "$(date -Iseconds)",
  "upload_dir": "${UPLOAD_DIR}",
  "files": ["$(ls -1 "${BACKUP_PATH}" | tr '\n' '","' | sed 's/","$//')"]
}
EOF

# 4. Clean up old backups
echo "  Cleaning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -maxdepth 1 -type d -name "20*" -mtime +${RETENTION_DAYS} -exec rm -rf {} + 2>/dev/null || true

TOTAL_SIZE=$(du -sh "${BACKUP_PATH}" | cut -f1)
echo "[$(date)] Backup complete: ${BACKUP_PATH} (${TOTAL_SIZE})"
