#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
release=${1:?Usage: release.sh COMMIT_SHA}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/bunker
exec 9>"$root/deploy.lock"
flock -w 1800 9
cd "$root/releases/$release"
test -s "$root/.env"
test -s "$root/domain"
domain=$(cat "$root/domain")
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 2
old_slot=''
old_release=''
if [[ -f "$root/active" ]]; then read -r old_slot old_release < "$root/active"; fi
slot=blue
port=4173
if [[ "$old_slot" == blue ]]; then slot=green; port=4174; fi
export RELEASE=$release APP_PORT=$port
compose=(docker compose -p "bunker-$slot" -f deploy/compose.release.yaml)
docker build -t "bunker-admin:$release" .
# Preserve hashed frontend assets so tabs opened before deployment keep working.
mkdir -p "$root/static/assets"
asset_container=$(docker create "bunker-admin:$release")
if ! docker cp "$asset_container:/app/web-dist/assets/." "$root/static/assets/"; then
  docker rm "$asset_container"
  exit 1
fi
docker rm "$asset_container"
chmod 755 "$root" "$root/static" "$root/static/assets"
find "$root/static/assets" -type f -exec chmod 644 {} +
# Existing infrastructure and its persistent volumes are never recreated here.
docker network inspect bunker-admin_default >/dev/null
mkdir -p "$root/backups"
if [[ -n "$old_slot" ]]; then
  docker compose --env-file "$root/.env" -f compose.yaml exec -T postgres \
    pg_dump -U bunker -d bunker -Fc > "$root/backups/before-$release.dump"
fi
# Seed preserves existing drafts; migrations must remain compatible with the old API.
"${compose[@]}" run --rm --no-deps api node dist/backend/db/seed.js
switched=false
rollback() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    if [[ -f "$root/proxy.previous" ]]; then
      cp "$root/proxy.previous" /etc/caddy/bunker.caddy
      if ! systemctl reload caddy; then
        echo 'Proxy rollback failed; leaving both slots running for recovery' >&2
        exit "$status"
      fi
    elif [[ "$switched" == true ]]; then
      echo 'First deployment failed after switching; leaving slot running for inspection' >&2
      exit "$status"
    fi
    "${compose[@]}" down || true
  fi
  exit "$status"
}
rm -f "$root/proxy.previous"
if [[ -f /etc/caddy/bunker.caddy ]]; then cp /etc/caddy/bunker.caddy "$root/proxy.previous"; fi
trap rollback EXIT
"${compose[@]}" up -d --wait --wait-timeout 150 api
"${compose[@]}" up -d worker
sleep 5
worker_id=$("${compose[@]}" ps -q worker)
[[ -n "$worker_id" && "$(docker inspect -f '{{.State.Running}}' "$worker_id")" == true ]]
[[ "$(docker inspect -f '{{.RestartCount}}' "$worker_id")" == 0 ]]
printf '%s {\n  encode zstd gzip\n  handle /assets/* {\n    root * /opt/bunker/static\n    file_server\n  }\n  handle {\n    reverse_proxy 127.0.0.1:%s\n  }\n}\n' "$domain" "$port" > /etc/caddy/bunker.caddy
chmod 644 /etc/caddy/bunker.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
switched=true
curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors \
  --connect-timeout 5 --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/api/health"
printf '%s %s\n' "$slot" "$release" > "$root/active.next"
mv "$root/active.next" "$root/active"
trap - EXIT
if [[ -n "$old_slot" ]]; then
  # Caddy drains existing HTTP requests before the previous containers stop.
  sleep 60
  RELEASE=$old_release APP_PORT=$([[ "$old_slot" == blue ]] && echo 4173 || echo 4174) \
    docker compose -p "bunker-$old_slot" -f "$root/releases/$old_release/deploy/compose.release.yaml" down
fi
echo "Deployed $release to $slot"
