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
cd "$root"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }

verify_app_containers() {
  python3 - "$image" <<'PY'
import json, subprocess, sys
expected = sys.argv[1]
for service in ('api', 'worker'):
    container = subprocess.check_output(['docker', 'compose', 'ps', '-q', service], text=True).strip()
    if not container:
        raise SystemExit(f'{service} container is missing')
    info = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
    if info['Config']['Image'] != expected or not info['State']['Running']:
        raise SystemExit(f'{service} is not running the requested image')
    if info['RestartCount']:
        raise SystemExit(f'{service} restarted unexpectedly')
PY
}

verify_mcp() {
  docker compose exec -T api node scripts/check-mcp.mjs
}

# A repeated Actions run must verify the active release rather than reject it.
if [[ -f "$root/active.json" ]] && python3 - "$root/active.json" "$release" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    sys.exit(0 if json.load(handle).get('release') == sys.argv[2] else 1)
PY
then
  verify_app_containers
  verify_mcp
  curl -fsS --max-time 10 --resolve bunker-vdk.ru:443:127.0.0.1 \
    https://bunker-vdk.ru/api/health > "$release_dir/health.json"
  python3 - "$release_dir/health.json" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    if json.load(handle).get('status') != 'ok':
        raise SystemExit('Unexpected health response')
PY
  echo "Already deployed $release on Hoster.kz; health and both containers verified"
  exit 0
fi

# Only retry a failed attempt if its rollback restored the same previous Compose.
if [[ -f "$release_dir/compose.before.yaml" ]] && ! cmp -s "$root/compose.yaml" "$release_dir/compose.before.yaml"; then
  echo 'Another release changed Compose after this attempt; refusing an outdated retry' >&2
  exit 1
fi

compose_changed=0
rollback() {
  local result=$?
  trap - EXIT
  if [[ "$result" != 0 && "$compose_changed" == 1 ]]; then
    cp "$release_dir/compose.before.yaml" "$root/compose.yaml"
    docker compose up -d --no-deps api worker || true
    echo 'Previous application image restored; database changes retained' >&2
  fi
  exit "$result"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker build --label "org.opencontainers.image.revision=$release" -t "$image" "$source_dir"
bash "$root/backup.sh"
if [[ ! -f "$release_dir/compose.before.yaml" ]]; then
  cp "$root/compose.yaml" "$release_dir/compose.before.yaml"
fi

compose_changed=1
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
verify_app_containers
verify_mcp
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
trap - EXIT
echo "Deployed $release on Hoster.kz"
