#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

release=${1:?Usage: hoster-release.sh <40-character commit SHA>}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }
root=/opt/bunker-production
release_dir="$root/releases/$release"
source_dir="$release_dir/source"
image="bunker-production:$release"
test -f "$source_dir/Dockerfile"
test -f "$root/compose.yaml"
test ! -e "$release_dir/compose.before.yaml"
cd "$root"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }

compose_changed=0
rollback() {
  local result=$?
  trap - ERR
  if [[ "$compose_changed" == 1 ]]; then
    cp "$release_dir/compose.before.yaml" "$root/compose.yaml"
    docker compose up -d --no-deps api worker || true
    echo 'Previous application image restored; database changes retained' >&2
  fi
  exit "$result"
}
trap rollback ERR

docker build --label "org.opencontainers.image.revision=$release" -t "$image" "$source_dir"
bash "$root/backup.sh"
cp "$root/compose.yaml" "$release_dir/compose.before.yaml"

python3 - "$root/compose.yaml" "$image" <<'PY'
import os, re, sys
path, image = sys.argv[1:]
with open(path) as handle:
    text = handle.read()
updated, count = re.subn(r'^  image: bunker-production:[^\n]+$', '  image: ' + image, text, flags=re.M)
if count != 1:
    raise SystemExit('Expected exactly one shared application image in Compose')
with open(path + '.next', 'w') as handle:
    handle.write(updated)
os.replace(path + '.next', path)
PY
compose_changed=1
docker compose run --rm --no-deps --entrypoint node api dist/backend/db/seed.js
docker compose stop -t 300 worker
docker compose up -d --no-deps api
docker compose up -d --no-deps worker

healthy=0
for attempt in {1..45}; do
  if curl -fsS --max-time 5 --resolve bunker-vdk.ru:443:127.0.0.1 \
      https://bunker-vdk.ru/api/health > "$release_dir/health.json"; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == 1 ]] || { echo 'HTTPS healthcheck failed' >&2; false; }
python3 - "$root/active.json" "$release" "$image" "$source_dir" "$release_dir/health.json" <<'PY'
import datetime, json, os, sys
path, release, image, source, health_path = sys.argv[1:]
with open(health_path) as handle:
    if json.load(handle).get('status') != 'ok':
        raise SystemExit('Unexpected health response')
with open(path + '.next', 'w') as handle:
    json.dump({'release': release, 'image': image, 'source': source,
               'deployedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}, handle, indent=2)
    handle.write('\n')
os.replace(path + '.next', path)
PY
trap - ERR
echo "Deployed $release on Hoster.kz"
