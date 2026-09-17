# Production и CI/CD

Адрес: https://bunker-vdk.ru. Домен зарегистрирован в REG.RU; A-записи @ и www указывают на 176.113.82.38. Репозиторий: https://github.com/ALegenda/Bunker-admin, ветка master.

Основной адрес хранится в `/opt/bunker/domain`, origin — в `/opt/bunker/.env`. Старый адрес `bunker-176-113-82-38.sslip.io` и `www.bunker-vdk.ru` перенаправляются на основной домен с сохранением пути и параметров. Конфигурация `deploy/nginx.redirects.conf` установлена отдельно как `/etc/nginx/sites-available/bunker-redirects` с ссылкой в `sites-enabled`, поэтому обычный деплой не перезаписывает редиректы. Сертификат `bunker-vdk.ru` покрывает основной домен и www; старый сертификат сохраняется для HTTPS-редиректа. Оба продлеваются через Certbot. После перехода на новый домен нужно заново войти: браузер не переносит cookie между доменами.

## Сервер

На сервере уже работают Nginx и другой сайт; Bunker использует отдельный virtual host `/etc/nginx/sites-available/bunker`. HTTPS выдан Let’s Encrypt; `certbot.timer` продлевает сертификат, deploy-hook перезагружает Nginx. Порты PostgreSQL не опубликованы, MinIO доступен только на loopback 59000. API слушает loopback 4173 или 4174. Секреты находятся в `/opt/bunker/.env` с правами 600. Приложение использует отдельную S3-учётную запись с доступом только к bucket bunker. Конфигурация инфраструктуры: `/opt/bunker/compose.infra.yaml`.

Сервер имеет около 900 МБ RAM и 2 ГБ swap. Сборка образа выполняется на GitHub runner. API ограничен 256 МБ, PDF-воркер — 512 МБ; одновременно работает один воркер. PDF может работать медленнее при использовании swap.

## Деплой

Workflow `.github/workflows/check.yml` проверяет типы, сборку и тесты PostgreSQL/S3/PDF. При push в master и repository variable `DEPLOY_ENABLED=true` следующий job собирает Linux-образ, публикует его в приватный `ghcr.io/alegenda/bunker-admin`; сервер скачивает слои из реестра, файлы deploy передаются по SSH и запускает `deploy/release.sh` для точного SHA коммита. GitHub environment production содержит DEPLOY_HOST, DEPLOY_USER, DEPLOY_KEY, DEPLOY_KNOWN_HOSTS. Закрытый ключ и пароли не входят в Git. Для скачивания контейнера используется краткоживущий GITHUB_TOKEN текущего Actions job; временный Docker login на сервере удаляется после загрузки. Тег master в реестре служит кешем сборки, деплой использует тег точного SHA.

Релизы находятся в `/opt/bunker/releases/<SHA>`, текущий слот/SHA — в `/opt/bunker/active`. Скрипт блокирует параллельные деплои, делает дамп PostgreSQL перед повторным обновлением, применяет миграции и идемпотентный seed. Новая API-версия запускается в свободном слоте blue/green и проходит healthcheck. После этого старый воркер завершает задание, запускается новый, Nginx переключается через graceful reload. При неуспехе проверки HTTPS возвращается предыдущая конфигурация и запускается старый воркер. Через 60 секунд старая API-версия останавливается.

База, сессии и файлы общие для обоих слотов. Хешированные JS/CSS старых версий сохраняются в `/opt/bunker/static/assets`, чтобы открытые вкладки продолжали загружать ресурсы.

Миграции должны оставаться совместимыми с предыдущей версией. Возврат приложения не откатывает схему БД. Старые образы и релизы автоматически не удаляются: отслеживайте свободное место, удаляйте только версии, которые больше не нужны для отката.

## Telegram

На этом сервере исходящее соединение с `oauth.telegram.org:443` завершается таймаутом. Экран входа использует официальный Telegram Login JS SDK: браузер получает подписанный ID token, сервер проверяет RS256, issuer, audience, срок, одноразовый nonce и привязку к HttpOnly cookie. Секрет бота не передаётся браузеру. Прямой OIDC callback оставлен для совместимости, но при блокировке сети использовать нужно кнопку на `/admin`.

Публичные ключи берутся только с официального HTTPS endpoint Telegram на GitHub runner: при каждом деплое и каждые шесть часов (`telegram-keys.yml`). Они атомарно устанавливаются в `/opt/bunker/telegram-keys/jwks.json`, каталог монтируется в API только для чтения. Ключи старше семи дней отвергаются. Ошибки refresh workflow нужно устранять; это необходимо для ротации ключей Telegram. `TELEGRAM_JWKS_FILE` включает этот режим, без него используется прямой JWKS endpoint.

`PUBLIC_ORIGIN=https://bunker-vdk.ru`, первый администратор `TELEGRAM_ADMIN_IDS=231142381` (@TomKuper). Client ID/Secret находятся только в серверном .env. В BotFather Web Login нужны Allowed URLs:

- https://bunker-vdk.ru
- https://bunker-vdk.ru/auth/callback

Чужие Telegram-аккаунты получают роль player. При смене IP обновите A-записи @ и www в REG.RU; origin и Allowed URLs остаются прежними.

## Резервные копии

`bunker-production-backup.timer` ежедневно запускает `/opt/bunker/backup.sh`: дамп PostgreSQL, копия bucket и SHA256SUMS. Каталог `/opt/bunker/backups/daily` доступен только root; завершённые ежедневные копии хранятся 14 дней. Дампы перед деплоями находятся отдельно в `/opt/bunker/backups`. Локальная копия не защищает от потери сервера — внешнее хранилище пока не настроено.

Для восстановления сначала проверить SHA256SUMS, восстановить database.dump через pg_restore в отдельную БД, загрузить objects в отдельный приватный bucket, отозвать старые сессии и проверить данные перед переключением. Реквизиты .env хранить отдельно от данных.

## Повторный запуск и проверка

Повторить деплой или откатить приложение при совместимой схеме: `bash /opt/bunker/releases/<SHA>/deploy/release.sh <SHA>` (образ должен оставаться на сервере). Проверка: `curl -f https://bunker-vdk.ru/api/health`. Логи: `docker compose -p bunker-blue -f /opt/bunker/releases/<SHA>/deploy/compose.release.yaml logs --tail 100` с соответствующими RELEASE и APP_PORT; для green использовать другой слот.

Первичная установка на новом сервере: Docker Compose v2; `deploy/compose.infra.yaml` и .env в `/opt/bunker`; поднять инфраструктуру; создать приватный bucket и scoped S3-пользователя; подготовить DNS, Nginx и сертификат; установить backup service/timer; настроить GitHub secrets; включить DEPLOY_ENABLED и отправить коммит в master. `deploy/nginx.conf.template` — рабочий шаблон; старые Caddy-примеры для этого сервера не используются.

## Загрузка главной и диагностика

Главная собирается из отдельного `frontend/landing.html`: стили встроены в HTML, JavaScript на этой странице отсутствует. Мобильное меню использует `<details>`, роли и ситуации — нативные радиокнопки и CSS. `index.html` и React остаются у каталога, профиля и админки. Иллюстрация использует адаптивные AVIF/WebP. Бюджет первой HTML-страницы со стилями — менее 20 КБ gzip, проверяется интеграционным тестом.

Nginx включает HTTP/2 через `listen 443 ssl http2` (совместимо с установленной версией 1.18); AVIF имеет отдельное правило MIME. При смене шаблона деплой выполняет `nginx -t` и откатывается при ошибке. См. [документацию HTTP/2](https://nginx.org/en/docs/http/ngx_http_v2_module.html).

Workflow `Production diagnostics` запускается вручную или при изменении своего скрипта/конфигурации. Он только читает состояние: три внешних запроса с runner, нагрузку, память, диск, контейнеры, сетевые счётчики и время ответа origin. Не выводит секреты, содержимое `.env` или данные запросов. Скрипт — `deploy/diagnose.sh`.
