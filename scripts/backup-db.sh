#!/usr/bin/env bash
# Ночной бэкап базы DnD-Hub из docker-контейнера Postgres.
# Запускается по cron на прод-сервере (Ubuntu). Настройка — docs/backup-setup.md.
#
# Переменные окружения (все со значениями по умолчанию):
#   PG_CONTAINER  имя контейнера Postgres            (dnd-postgres)
#   PG_DATABASE   имя базы                            (dnd_hub)
#   PG_USER       пользователь Postgres               (postgres)
#   BACKUP_DIR    куда складывать бэкапы              (/var/backups/dnd-hub)
#   KEEP_DAYS     сколько дней хранить                (14)
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-dnd-postgres}"
PG_DATABASE="${PG_DATABASE:-dnd_hub}"
PG_USER="${PG_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dnd-hub}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
FILE="$BACKUP_DIR/${PG_DATABASE}_${STAMP}.dump"

# Дамп в "custom" формате (-Fc): сжат и восстанавливается pg_restore выборочно.
# Сначала пишем во временный файл, чтобы оборванный дамп не выглядел готовым.
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DATABASE" > "$FILE.part"
mv "$FILE.part" "$FILE"

# Удаляем дампы старше KEEP_DAYS дней (и забытые .part-обрывки старше суток).
find "$BACKUP_DIR" -name "${PG_DATABASE}_*.dump" -type f -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name "*.part" -type f -mtime +1 -delete

echo "OK: $FILE ($(du -h "$FILE" | cut -f1))"
