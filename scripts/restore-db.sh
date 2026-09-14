#!/usr/bin/env bash
# Восстановление базы DnD-Hub из дампа, снятого scripts/backup-db.sh.
#
# Использование:
#   ./restore-db.sh <файл.dump> <имя-базы>
#
# База назначения будет СОЗДАНА, если её нет. Если база уже существует,
# скрипт откажется работать без CONFIRM_OVERWRITE=yes — чтобы нельзя было
# случайно затереть живую базу.
#
# Переменные окружения: PG_CONTAINER (dnd-postgres), PG_USER (postgres).
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-dnd-postgres}"
PG_USER="${PG_USER:-postgres}"

if [ $# -lt 2 ]; then
  echo "Использование: $0 <файл.dump> <имя-базы>" >&2
  exit 1
fi

DUMP_FILE="$1"
TARGET_DB="$2"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Файл не найден: $DUMP_FILE" >&2
  exit 1
fi

DB_EXISTS="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"

if [ "$DB_EXISTS" = "1" ]; then
  if [ "${CONFIRM_OVERWRITE:-}" != "yes" ]; then
    echo "База '$TARGET_DB' уже существует. Восстановление ЗАТРЁТ её содержимое." >&2
    echo "Если вы уверены: CONFIRM_OVERWRITE=yes $0 $DUMP_FILE $TARGET_DB" >&2
    exit 1
  fi
else
  docker exec "$PG_CONTAINER" createdb -U "$PG_USER" "$TARGET_DB"
fi

# --clean --if-exists: сначала удалить объекты, потом создать заново;
# --no-owner: не пытаться выставлять владельца из дампа.
docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$TARGET_DB" \
  --clean --if-exists --no-owner < "$DUMP_FILE"

echo "OK: база '$TARGET_DB' восстановлена из $DUMP_FILE"
