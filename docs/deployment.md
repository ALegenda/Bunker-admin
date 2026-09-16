# Production и CI/CD

Адрес: https://bunker-176-113-82-38.sslip.io. Бесплатное DNS-имя sslip.io указывает на 176.113.82.38. Репозиторий: https://github.com/ALegenda/Bunker-admin, ветка master.

## Сервер

На сервере уже работают Nginx и другой сайт; Bunker использует отдельный virtual host `/etc/nginx/sites-available/bunker`. HTTPS выдан Let’s Encrypt; `certbot.timer` продлевает сертификат, deploy-hook перезагружает Nginx. Порты PostgreSQL не опубликованы, MinIO доступен только на loopback 59000. API слушает loopback 4173 или 4174. Секреты находятся в `/opt/bunker/.env` с правами 600. Приложение использует отдельную S3-учётную запись с доступом только к bucket bunker. Конфигурация инфраструктуры: `/opt/bunker/compose.infra.yaml`.

Сервер имеет около 900 МБ RAM и 2 ГБ swap. Сборка образа выполняется на GitHub runner. API ограничен 256 МБ, PDF-воркер — 512 МБ; одновременно работает один воркер. PDF может работать медленнее при использовании swap.

## Деплой

Workflow `.github/workflows/check.yml` проверяет типы, сборку и тесты PostgreSQL/S3/PDF. При push в master и repository variable `DEPLOY_ENABLED=true` следующий job собирает Linux-образ, передаёт его с файлами deploy по SSH и запускает `deploy/release.sh` для точного SHA коммита. GitHub environment production содержит DEPLOY_HOST, DEPLOY_USER, DEPLOY_KEY, DEPLOY_KNOWN_HOSTS. Закрытый ключ и пароли не входят в Git.

Релизы находятся в `/opt/bunker/releases/<SHA>`, текущий слот/SHA — в `/opt/bunker/active`. Скрипт блокирует параллельные деплои, делает дамп PostgreSQL перед повторным обновлением, применяет миграции и идемпотентный seed. Новая API-версия запускается в свободном слоте blue/green и проходит healthcheck. После этого старый воркер завершает задание, запускается новый, Nginx переключается через graceful reload. При неуспехе проверки HTTPS возвращается предыдущая конфигурация и запускается старый воркер. Через 60 секунд старая API-версия останавливается.

База, сессии и файлы общие для обоих слотов. Хешированные JS/CSS старых версий сохраняются в `/opt/bunker/static/assets`, чтобы открытые вкладки продолжали загружать ресурсы.

Миграции должны оставаться совместимыми с предыдущей версией. Возврат приложения не откатывает схему БД. Старые образы и релизы автоматически не удаляются: отслеживайте свободное место, удаляйте только версии, которые больше не нужны для отката.

## Telegram

`PUBLIC_ORIGIN=https://bunker-176-113-82-38.sslip.io`, первый администратор `TELEGRAM_ADMIN_IDS=231142381` (@TomKuper). Client ID/Secret находятся только в серверном .env. В BotFather Web Login нужны Allowed URLs:

- https://bunker-176-113-82-38.sslip.io
- https://bunker-176-113-82-38.sslip.io/auth/callback

Чужие Telegram-аккаунты получают роль player. При смене IP потребуется новое DNS-имя, сертификат, origin и Allowed URLs.

## Резервные копии

`bunker-production-backup.timer` ежедневно запускает `/opt/bunker/backup.sh`: дамп PostgreSQL, копия bucket и SHA256SUMS. Каталог `/opt/bunker/backups/daily` доступен только root; завершённые ежедневные копии хранятся 14 дней. Дампы перед деплоями находятся отдельно в `/opt/bunker/backups`. Локальная копия не защищает от потери сервера — внешнее хранилище пока не настроено.

Для восстановления сначала проверить SHA256SUMS, восстановить database.dump через pg_restore в отдельную БД, загрузить objects в отдельный приватный bucket, отозвать старые сессии и проверить данные перед переключением. Реквизиты .env хранить отдельно от данных.

## Повторный запуск и проверка

Повторить деплой или откатить приложение при совместимой схеме: `bash /opt/bunker/releases/<SHA>/deploy/release.sh <SHA>` (образ должен оставаться на сервере). Проверка: `curl -f https://bunker-176-113-82-38.sslip.io/api/health`. Логи: `docker compose -p bunker-blue -f /opt/bunker/releases/<SHA>/deploy/compose.release.yaml logs --tail 100` с соответствующими RELEASE и APP_PORT; для green использовать другой слот.

Первичная установка на новом сервере: Docker Compose v2; `deploy/compose.infra.yaml` и .env в `/opt/bunker`; поднять инфраструктуру; создать приватный bucket и scoped S3-пользователя; подготовить DNS, Nginx и сертификат; установить backup service/timer; настроить GitHub secrets; включить DEPLOY_ENABLED и отправить коммит в master. `deploy/nginx.conf.template` — рабочий шаблон; старые Caddy-примеры для этого сервера не используются.
