#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="/opt/thg-brain/docker-compose.yml"
DATA_DIR="/opt/thg-brain-data/trilium-data"
CONTAINER_NAME="thg-brain-trilium"

LOCAL_DIR="/var/tmp/lore-backups"

REMOTE_USER="feanor08"
REMOTE_HOST="192.168.0.168"
REMOTE_ROOT="/srv/thg-backup"
REMOTE_DIR="${REMOTE_ROOT}/lore"
REMOTE_FS_UUID="1d347b64-77cd-4e2b-8f90-aa78b5284593"

SSH_KEY="/home/feanor08/.ssh/id_ed25519_lore_backup"
KNOWN_HOSTS="/home/feanor08/.ssh/known_hosts"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
ARCHIVE_NAME="lore-full-${TIMESTAMP}.tar.gz"
SHA_NAME="${ARCHIVE_NAME}.sha256"

LOCAL_ARCHIVE="${LOCAL_DIR}/${ARCHIVE_NAME}"
LOCAL_SHA="${LOCAL_DIR}/${SHA_NAME}"
SOURCE_VERSION="$(git -C "$(dirname "${COMPOSE_FILE}")" rev-parse HEAD 2>/dev/null || printf 'unknown')"

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
echo "source_version=${SOURCE_VERSION}"
echo "created_at_utc=${TIMESTAMP}"

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

echo "Checking local archive integrity..."
tar -tzf "${LOCAL_ARCHIVE}" >/dev/null

(
    cd "${LOCAL_DIR}"
    sha256sum "${ARCHIVE_NAME}" > "${SHA_NAME}"
)
ARCHIVE_SHA="$(awk '{print $1}' "${LOCAL_SHA}")"

echo "Verifying canonical remote backup filesystem..."
ACTUAL_REMOTE_UUID="$(
    ssh "${SSH_OPTS[@]}" \
        "${REMOTE_USER}@${REMOTE_HOST}" \
        "findmnt -T '${REMOTE_ROOT}' -n -o UUID"
)"
if [[ "${ACTUAL_REMOTE_UUID}" != "${REMOTE_FS_UUID}" ]]; then
    echo "ERROR: ${REMOTE_ROOT} UUID is ${ACTUAL_REMOTE_UUID:-missing}; expected ${REMOTE_FS_UUID}" >&2
    exit 1
fi
echo "destination_uuid=${ACTUAL_REMOTE_UUID}"

echo "Preparing remote backup directory..."
ssh "${SSH_OPTS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "mkdir -p '${REMOTE_DIR}' && chmod 700 '${REMOTE_DIR}'"

echo "Uploading backup to switchboard..."
scp "${SSH_OPTS[@]}" \
    "${LOCAL_ARCHIVE}" \
    "${LOCAL_SHA}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Verifying remote checksum and archive integrity..."
ssh "${SSH_OPTS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && sha256sum -c '${SHA_NAME}' && tar -tzf '${ARCHIVE_NAME}' >/dev/null && chmod 600 '${ARCHIVE_NAME}' '${SHA_NAME}'"

# Retention is deliberately not enforced here. Historical backups are preserved
# until an explicit, separately reviewed retention policy is approved.

rm -f "${LOCAL_ARCHIVE}" "${LOCAL_SHA}"

echo "Lore backup completed successfully."
echo "Remote backup: ${REMOTE_DIR}/${ARCHIVE_NAME}"
echo "archive_sha256=${ARCHIVE_SHA}"
