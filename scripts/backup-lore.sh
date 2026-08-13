#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="/opt/thg-brain/docker-compose.yml"
DATA_DIR="/opt/thg-brain-data/trilium-data"
CONTAINER_NAME="thg-brain-trilium"

LOCAL_DIR="/var/tmp/lore-backups"

REMOTE_USER="feanor08"
REMOTE_HOST="192.168.0.168"
REMOTE_DIR="/srv/thg-data/backups/lore"

SSH_KEY="/home/feanor08/.ssh/id_ed25519_lore_backup"
KNOWN_HOSTS="/home/feanor08/.ssh/known_hosts"

RETENTION_DAYS=14

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
ARCHIVE_NAME="lore-full-${TIMESTAMP}.tar.gz"
SHA_NAME="${ARCHIVE_NAME}.sha256"

LOCAL_ARCHIVE="${LOCAL_DIR}/${ARCHIVE_NAME}"
LOCAL_SHA="${LOCAL_DIR}/${SHA_NAME}"

SSH_OPTS=(
    -i "${SSH_KEY}"
    -o BatchMode=yes
    -o StrictHostKeyChecking=yes
    -o UserKnownHostsFile="${KNOWN_HOSTS}"
)

TRILIUM_STOPPED=0

restart_trilium_if_needed() {
    if [[ "${TRILIUM_STOPPED}" -eq 1 ]]; then
        echo "Restarting Trilium after interrupted backup..."
        docker compose -f "${COMPOSE_FILE}" start trilium || true
    fi
}

trap restart_trilium_if_needed EXIT INT TERM

mkdir -p "${LOCAL_DIR}"

echo "Creating Lore backup: ${ARCHIVE_NAME}"

echo "Stopping Trilium..."
docker compose -f "${COMPOSE_FILE}" stop trilium
TRILIUM_STOPPED=1

echo "Creating local snapshot..."
tar \
    --numeric-owner \
    -C "$(dirname "${DATA_DIR}")" \
    -czf "${LOCAL_ARCHIVE}" \
    "$(basename "${DATA_DIR}")"

echo "Starting Trilium..."
docker compose -f "${COMPOSE_FILE}" start trilium
TRILIUM_STOPPED=0

echo "Waiting for Trilium health check..."
for attempt in $(seq 1 30); do
    HEALTH="$(
        docker inspect \
            --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
            "${CONTAINER_NAME}" 2>/dev/null || true
    )"

    if [[ "${HEALTH}" == "healthy" ]]; then
        echo "Trilium is healthy."
        break
    fi

    if [[ "${attempt}" -eq 30 ]]; then
        echo "ERROR: Trilium did not become healthy after backup." >&2
        exit 1
    fi

    sleep 2
done

echo "Checking archive integrity..."
tar -tzf "${LOCAL_ARCHIVE}" >/dev/null

(
    cd "${LOCAL_DIR}"
    sha256sum "${ARCHIVE_NAME}" > "${SHA_NAME}"
)

echo "Preparing remote backup directory..."
ssh "${SSH_OPTS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "mkdir -p '${REMOTE_DIR}' && chmod 700 '${REMOTE_DIR}'"

echo "Uploading backup to switchboard..."
scp "${SSH_OPTS[@]}" \
    "${LOCAL_ARCHIVE}" \
    "${LOCAL_SHA}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Verifying remote checksum..."
ssh "${SSH_OPTS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && sha256sum -c '${SHA_NAME}' && chmod 600 '${ARCHIVE_NAME}' '${SHA_NAME}'"

echo "Removing backups older than ${RETENTION_DAYS} days..."
ssh "${SSH_OPTS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "find '${REMOTE_DIR}' -maxdepth 1 -type f -name 'lore-full-*' -mtime +${RETENTION_DAYS} -delete"

rm -f "${LOCAL_ARCHIVE}" "${LOCAL_SHA}"

echo "Lore backup completed successfully."
echo "Remote backup: ${REMOTE_DIR}/${ARCHIVE_NAME}"