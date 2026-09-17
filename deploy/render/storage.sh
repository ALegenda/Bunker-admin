#!/bin/sh
set -eu
umask 077
: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
if [ "$MINIO_ROOT_USER" = "$S3_ACCESS_KEY" ]; then
  echo 'Use separate root and application credentials' >&2
  exit 1
fi
export MC_CONFIG_DIR
MC_CONFIG_DIR=$(mktemp -d)
minio server /data --address :9000 &
server_pid=$!
cleanup() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  rm -rf "$MC_CONFIG_DIR"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

attempt=0
until curl --silent --fail http://127.0.0.1:9000/minio/health/ready >/dev/null; do
  kill -0 "$server_pid" 2>/dev/null || exit 1
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'Storage did not become ready within 60 seconds' >&2
    exit 1
  fi
  sleep 1
done

# Keep credentials and mc's output out of the platform logs.
quiet_mc() {
  if ! mc "$@" >/dev/null 2>&1; then
    echo 'Storage initialization failed' >&2
    exit 1
  fi
}
quiet_mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
quiet_mc mb --ignore-existing local/bunker
cat > "$MC_CONFIG_DIR/bunker-policy.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::bunker"]},
    {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::bunker/*"]}
  ]
}
JSON
quiet_mc admin policy create local bunker-app "$MC_CONFIG_DIR/bunker-policy.json"
quiet_mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
quiet_mc admin policy attach local bunker-app --user "$S3_ACCESS_KEY"
echo 'Private storage ready; application access is limited to the bunker bucket'
wait "$server_pid"
