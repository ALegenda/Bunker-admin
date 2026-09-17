#!/usr/bin/env bash
# Read-only production diagnostics; never prints environment files or request data.
set -euo pipefail
uptime
free -m
df -h /opt/bunker
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'
ss -s
nginx -V 2>&1
if command -v nstat >/dev/null; then
  nstat -az TcpRetransSegs TcpExtListenOverflows TcpExtListenDrops TcpExtSyncookiesSent
fi
domain=$(cat /opt/bunker/domain)
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]]
for route in / /api/health; do
  curl -sS --compressed --connect-timeout 5 --max-time 15 --resolve "$domain:443:127.0.0.1" \
    -o /dev/null -w "origin $route status=%{http_code} protocol=%{http_version} ttfb=%{time_starttransfer} total=%{time_total}\n" "https://$domain$route"
done
