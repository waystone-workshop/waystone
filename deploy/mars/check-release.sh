#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
tag=$(curl --fail --silent --show-error https://api.github.com/repos/waystone-workshop/waystone/releases/latest | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
current=$(cat current-release 2>/dev/null || true)
[[ "$tag" != "$current" ]] || exit 0
if [[ -n "$current" && "$(printf '%s\n%s\n' "$current" "$tag" | sort -V | tail -n1)" != "$tag" ]]; then
  echo 'Refusing an automatic downgrade'
  exit 1
fi
exec bash install-release.sh "$tag"
