#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077
for command in docker tailscale openssl python3 curl; do
  command -v "$command" >/dev/null || { echo "Required on Mars: $command" >&2; exit 1; }
done
docker compose version >/dev/null
if [[ ! -e .env ]]; then
  host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  ip=$(tailscale ip -4)
  [[ "$host" =~ ^[a-zA-Z0-9.-]+\.ts\.net$ && "$ip" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Cannot identify Mars tailnet address' >&2; exit 1; }
  {
    printf 'WAYSTONE_VERSION=0.4.2\nPHX_HOST=%s\n' "$host"
    printf 'SECRET_KEY_BASE=%s\n' "$(openssl rand -hex 64)"
    printf 'WAYSTONE_INVITE_CODE=%s\n' "$(openssl rand -hex 16)"
    printf 'LIVEKIT_URL=wss://%s:8443\nLIVEKIT_API_KEY=waystone\n' "$host"
    printf 'LIVEKIT_API_SECRET=%s\nMARS_TAILSCALE_IP=%s\n' "$(openssl rand -hex 32)" "$ip"
  } > .env
  chmod 600 .env
  echo 'Generated private deployment credentials in .env (not printed).'
else
  echo 'Existing .env preserved.'
fi
echo 'Ready for: bash install-release.sh v0.4.2'
