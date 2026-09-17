#!/bin/sh
set -eu

# Blueprint service references provide a hostname, not an S3 URL.
if [ -z "${S3_ENDPOINT:-}" ]; then
  export S3_ENDPOINT="http://${S3_HOST:?Set S3_HOST or S3_ENDPOINT}:9000"
fi

case "${1:-}" in
  api) exec node dist/backend/http/server.js ;;
  worker) exec node dist/backend/worker.js ;;
  worker-once) exec node dist/backend/worker-once.js ;;
  seed) exec node dist/backend/db/seed.js ;;
  *) echo 'Usage: start.sh api|worker|worker-once|seed' >&2; exit 2 ;;
esac
