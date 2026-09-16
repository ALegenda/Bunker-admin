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
if [[ -f image.tar.gz ]]; then
  gzip -dc image.tar.gz | docker load
  rm image.tar.gz
fi
docker image inspect "bunker-admin:$release" >/dev/null
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
  docker compose --env-file "$root/.env" -f deploy/compose.infra.yaml exec -T postgres \
    pg_dump -U bunker -d bunker -Fc > "$root/backups/before-$release.dump"
fi
# Seed preserves existing drafts; migrations must remain compatible with the old API.
"${compose[@]}" run --rm --no-deps api node dist/backend/db/seed.js
switched=false
old_worker_stopped=false
rollback() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    if [[ -f "$root/proxy.previous" ]]; then
      cp "$root/proxy.previous" /etc/nginx/sites-available/bunker
      if ! (nginx -t && systemctl reload nginx); then
        echo 'Proxy rollback failed; leaving both slots running for recovery' >&2
        exit "$status"
      fi
    elif [[ "$switched" == true ]]; then
      echo 'First deployment failed after switching; leaving slot running for inspection' >&2
      exit "$status"
    fi
    "${compose[@]}" down || true
    if [[ "$old_worker_stopped" == true ]]; then old_compose start worker || true; fi
  fi
  exit "$status"
}
old_compose() {
  RELEASE=$old_release APP_PORT=$([[ "$old_slot" == blue ]] && echo 4173 || echo 4174) \
    docker compose -p "bunker-$old_slot" -f "$root/releases/$old_release/deploy/compose.release.yaml" "$@"
}
rm -f "$root/proxy.previous"
if [[ -f /etc/nginx/sites-available/bunker ]]; then cp /etc/nginx/sites-available/bunker "$root/proxy.previous"; fi
trap rollback EXIT
"${compose[@]}" up -d --wait --wait-timeout 150 api
if [[ -n "$old_slot" ]]; then
  old_compose stop worker
  old_worker_stopped=true
fi
"${compose[@]}" up -d worker
sleep 5
worker_id=$("${compose[@]}" ps -q worker)
[[ -n "$worker_id" && "$(docker inspect -f '{{.State.Running}}' "$worker_id")" == true ]]
[[ "$(docker inspect -f '{{.RestartCount}}' "$worker_id")" == 0 ]]
sed -e "s/__DOMAIN__/$domain/g" -e "s/__PORT__/$port/g" deploy/nginx.conf.template > /etc/nginx/sites-available/bunker
chmod 644 /etc/nginx/sites-available/bunker
nginx -t
systemctl reload nginx
switched=true
healthy=false
for attempt in {1..10}; do
  if curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    --resolve "$domain:443:127.0.0.1" "https://$domain/api/health"; then
    healthy=true
    break
  fi
  sleep 3
done
[[ "$healthy" == true ]]
printf '%s %s\n' "$slot" "$release" > "$root/active.next"
mv "$root/active.next" "$root/active"
trap - EXIT
if [[ -n "$old_slot" ]]; then
  # Nginx drains existing HTTP requests before the previous containers stop.
  sleep 60
  RELEASE=$old_release APP_PORT=$([[ "$old_slot" == blue ]] && echo 4173 || echo 4174) \
    docker compose -p "bunker-$old_slot" -f "$root/releases/$old_release/deploy/compose.release.yaml" down
fi
echo "Deployed $release to $slot"
