#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 9>/opt/bunker/deploy.lock
flock -w 1800 9
destination=/opt/bunker/backups/daily/$(date -u +%Y-%m-%dT%H-%M-%SZ)
mkdir -p "$destination/objects"
docker compose --env-file /opt/bunker/.env -f /opt/bunker/compose.infra.yaml \
  exec -T postgres pg_dump -U bunker -d bunker -Fc > "$destination/database.dump"
/opt/bunker/bin/mc --config-dir /opt/bunker/.mc mirror local/bunker "$destination/objects"
cd "$destination"
find . -type f ! -name SHA256SUMS.tmp -print0 | sort -z | xargs -0 sha256sum > "$destination/SHA256SUMS.tmp"
mv SHA256SUMS.tmp SHA256SUMS
touch COMPLETE
# Only completed daily backups older than two weeks are removed.
find /opt/bunker/backups/daily -mindepth 2 -maxdepth 2 -name COMPLETE -mtime +14 \
  -exec sh -c 'rm -rf -- "$(dirname "$1")"' sh {} \;
echo "Backup complete: $destination"
