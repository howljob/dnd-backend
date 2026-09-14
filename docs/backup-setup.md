# Бэкапы базы данных на проде — установка и проверка

Прод: Ubuntu 24.04, Postgres 16 в docker-контейнере `dnd-postgres`,
бэкенд — systemd-сервис `dnd-backend`, репозиторий развёрнут на сервере.

Скрипты лежат в репозитории бэкенда:

- `scripts/backup-db.sh` — снимает `pg_dump` (custom-формат, сжатый) из контейнера,
  кладёт файл с датой в каталог бэкапов, удаляет дампы старше 14 дней;
- `scripts/restore-db.sh` — восстанавливает дамп в указанную базу
  (существующую базу не трогает без `CONFIRM_OVERWRITE=yes`).

Ниже `<REPO>` — путь к репозиторию бэкенда на сервере (например,
`/opt/dnd-backend` или `/home/deploy/dnd-backend`). Подставьте свой.

## 1. Установка (один раз, под root или через sudo)

```bash
# 1) Каталог для бэкапов
sudo mkdir -p /var/backups/dnd-hub
sudo chmod 750 /var/backups/dnd-hub

# 2) Права на исполнение
sudo chmod +x <REPO>/scripts/backup-db.sh <REPO>/scripts/restore-db.sh

# 3) Пробный запуск руками — должен напечатать "OK: /var/backups/dnd-hub/dnd_hub_<дата>.dump"
sudo <REPO>/scripts/backup-db.sh

# 4) Ночной запуск в 03:30 по времени сервера — файл в /etc/cron.d
sudo tee /etc/cron.d/dnd-hub-backup > /dev/null <<'EOF'
# Ночной бэкап базы DnD-Hub (хранится 14 дней, см. scripts/backup-db.sh)
30 3 * * * root <REPO>/scripts/backup-db.sh >> /var/log/dnd-hub-backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/dnd-hub-backup
```

**Важно:** в файле `/etc/cron.d/dnd-hub-backup` замените `<REPO>` на реальный
путь — cron не разворачивает переменные. Cron из `/etc/cron.d` подхватывается
автоматически, перезапускать ничего не нужно.

Если имя контейнера или базы на проде отличается от `dnd-postgres` / `dnd_hub`,
задайте их в строке cron через переменные, например:

```
30 3 * * * root PG_CONTAINER=dnd-postgres PG_DATABASE=dnd_hub <REPO>/scripts/backup-db.sh >> /var/log/dnd-hub-backup.log 2>&1
```

## 2. Проверка, что бэкапы идут

```bash
ls -lh /var/backups/dnd-hub/          # каждую ночь появляется новый .dump
tail /var/log/dnd-hub-backup.log      # последняя строка — "OK: ..."
```

Старые дампы (старше 14 дней) удаляются самим скриптом; каталог не растёт
бесконечно.

## 3. Восстановление

Проверка дампа на «живость» (в отдельную базу, прод не трогается):

```bash
sudo <REPO>/scripts/restore-db.sh /var/backups/dnd-hub/dnd_hub_<дата>.dump dnd_hub_check
docker exec dnd-postgres psql -U postgres -d dnd_hub_check -c '\dt'   # таблицы на месте?
docker exec dnd-postgres psql -U postgres -c 'DROP DATABASE dnd_hub_check;'
```

Боевое восстановление прод-базы (после аварии):

```bash
sudo systemctl stop dnd-backend       # 1) остановить бэкенд, чтобы никто не писал в базу
CONFIRM_OVERWRITE=yes sudo -E <REPO>/scripts/restore-db.sh \
  /var/backups/dnd-hub/dnd_hub_<дата>.dump dnd_hub          # 2) восстановить
sudo systemctl start dnd-backend      # 3) запустить обратно
curl -s http://127.0.0.1:4000/health  # 4) {"ok":true,...}
```

## 4. Что уже проверено локально (2026-09-14, трек T1)

Полный цикл прогнан этими же скриптами на локальной базе `dnd_hub_t1`:
дамп снят (`backup-db.sh`, 120 КБ), восстановлен в новую базу
`dnd_hub_t1_restore` (`restore-db.sh`), список таблиц совпал с оригиналом
(33 таблицы, `diff` пустой), тестовая база удалена.

На проде остаётся сделать один раз: установку из раздела 1 и одну проверку
восстановления из раздела 3 (в `dnd_hub_check`).

## 5. Чего этот механизм НЕ покрывает

- Загруженные файлы (`uploads/vtt` — карты стола) в дамп базы не входят;
  их нужно бэкапить отдельно (rsync/tar по тому же cron — решить отдельной задачей).
- Копия лежит на том же сервере: при потере сервера пропадёт и база, и бэкап.
  Выгрузка в внешнее хранилище — отдельная задача.
