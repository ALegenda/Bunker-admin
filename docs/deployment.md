# Production: VPS Hoster.kz

Рабочий сайт: https://bunker-vdk.ru. С 4 октября 2026 года API, PostgreSQL,
MinIO и обработчик PDF работают на **VPS Hoster.kz в Астане**. Параметры
сервера и состояние контейнеров перепроверены 10 октября 2026 года.
Render — прежнее размещение; [его инструкция](render.md) сохранена как архив.

## Сервер и адреса

- SSH: `root@89.126.194.117`, hostname `cloud-001.h-165642.kz`.
- Ubuntu 24.04, 2 vCPU, 4 ГБ RAM, 50 ГБ диска.
- REG.RU: `A @ → 89.126.194.117`, `CNAME www → bunker-vdk.ru.`, TTL 3600.
- Основной стек: `/opt/bunker-production`, Compose project `bunker-production`.
- API: `127.0.0.1:4174`; MinIO: `127.0.0.1:59001`; PostgreSQL не опубликован наружу.
- Прокси: Caddy, активная конфигурация `/etc/caddy/Caddyfile`; `www` перенаправляется на основной домен.
- TLS: Let's Encrypt, продление через `certbot.timer` и HTTP webroot;
  deploy hook `/opt/bunker-production/deploy-certificate.sh` перезагружает Caddy.

Секреты находятся отдельно: `api.env`, `db.env`, `storage.env` в каталоге
стека, права 600. Compose читает их через `env_file` с `format: raw`.
Не выводить эти файлы в логи и не включать их в исходники или архив релиза.
PostgreSQL и MinIO используют постоянные тома; смена образа API их не пересоздаёт.
Работает один PDF-worker с лимитом 1536 МБ; API — 512 МБ, PostgreSQL — 512 МБ,
MinIO — 384 МБ. На сервере не запускать несколько тяжёлых сборок одновременно.

Отдельный readonly-тест остался в `/opt/bunker-test`, API на loopback 4173.
Это исходная копия без актуальных пользователей и правок; она не является
источником production-данных.

## Доступ

Использовать существующий SSH-ключ Hoster и проверенный `trusted_host_key`
из локального комплекта переноса. Закрытый ключ не хранится в Git.
Проверенный ED25519 fingerprint сервера:
`SHA256:Bt3HkaktjLmWe4tB1pOK9b8gOnHuxp+tvp1hhEDtxp8`.

```sh
ssh -o ConnectTimeout=15 -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$BUNKER_KNOWN_HOSTS" \
  -i "$BUNKER_SSH_KEY" root@89.126.194.117
```

`BUNKER_SSH_KEY` и `BUNKER_KNOWN_HOSTS` — пути к существующим локальным файлам.
При проблеме VPN можно привязать только это соединение к рабочему интерфейсу
macOS через `-o 'ProxyCommand=nc -b en0 -w 30 %h %p'`; проверка ключа сервера
остаётся обязательной. Системные настройки сети менять не требуется.

## Обновление

GitHub CI проверяет типы, сборку и тесты. Push сам по себе не подтверждает
обновление Hoster. Прежний job при `DEPLOY_ENABLED=true` и `deploy/release.sh`
предназначены для старого Nginx-стека `/opt/bunker`; не запускать их здесь.

Релиз должен содержать production-исправление переноса
`ce33d93c7a530d0e5098df7f618c35957cca89e1`: native cookie-сессии работают,
когда Pages и основной сайт используют один origin. Сохранять действующий код
Pages API и не откатывать приложение на состояние до переноса.

Порядок для проверенного коммита:

1. Выполнить `npm run typecheck`, `npm test`, `npm run build` локально.
2. Создать `git archive` точного SHA; передать по проверенному SSH и распаковать
   в `/opt/bunker-production/releases/<SHA>/source`. Не копировать `.env`,
   локальные данные или тестовую базу.
3. На сервере выполнить:

   ```sh
   bash /opt/bunker-production/releases/<SHA>/source/deploy/hoster-release.sh <SHA>
   ```

Скрипт блокирует параллельные обновления, собирает новый образ, запускает
существующий полный backup и сохраняет прежний Compose. Затем применяет
идемпотентный `db:seed` новым образом, завершает старый worker, обновляет
API/worker и проверяет HTTPS. PostgreSQL, MinIO, секреты и Caddy не меняются.
При ошибке восстанавливает прежний образ приложения; миграции БД автоматически
не откатываются. Исходники и `active.json` сохраняются на сервере вместе с SHA.
Backup-скрипт пока использует исходный образ переноса: его нельзя удалять,
пока не обновлено и не проверено резервное копирование.

После обновления проверить health, каталог, изображения, вход и затронутый
сценарий. Для оформления карточек сверить отчёт миграции
`rules-2026-10-10-description-formatting`: проверено 329 описаний, план меняет
201. Ручные правки черновика и публичного текста могут уменьшить число изменений;
пропуски с причинами и полная копия до изменений сохраняются в БД.
Старые выпуски и готовые PDF остаются прежними; новый PDF использует новое оформление.

## Telegram

`AUTH_MODE=telegram`, `PUBLIC_ORIGIN=https://bunker-vdk.ru`, существующий
бот `@bunker_vdk_bot`. Client ID/Secret и остальные параметры сохраняются
в серверном `api.env`; нового бота для обновления создавать не нужно.
Allowed URLs включают основной origin и `https://bunker-vdk.ru/auth/callback`.
Local/dev auth в production недоступен.

## Резервные копии и откат

`bunker-hoster-backup.timer` запускает `/opt/bunker-production/backup.sh`.
Копия включает PostgreSQL, объекты MinIO, `SHA256SUMS` и маркер `COMPLETE`;
каталог `/opt/bunker-production/backups/daily` доступен только root.
Автоматическое удаление копий не включено. Копии переноса также сохранены
в локальном комплекте; актуальную копию после новых записей нужно сохранять
вне VPS отдельно.

Перед откатом сохранить новую копию. Для совместимой схемы вернуть
`compose.before.yaml` из каталога нужного релиза в `compose.yaml` и выполнить
`docker compose up -d --no-deps api worker` из `/opt/bunker-production`.
Это возвращает приложение, сохраняя текущие данные. Восстановление БД
проводить отдельно в новую базу после проверки checksum; оно может потерять
записи после снимка. Старые образы и архивы не удалять до проверки отката.
Не выполнять `docker compose down -v` для рабочего стека.

## Проверка и логи

```sh
curl -fsS https://bunker-vdk.ru/api/health
cd /opt/bunker-production
docker compose ps
docker compose logs --tail 100 api worker
systemctl status bunker-hoster-backup.timer certbot.timer
```

Не выводить `docker inspect` целиком или раскрытый Compose: они могут содержать
секреты окружения. Для версии достаточно имени образа и OCI label revision.
Старые GitHub workflows `production-diagnostics.yml` и `telegram-keys.yml` используют
пути прежнего VPS; они не подтверждают состояние Hoster.
