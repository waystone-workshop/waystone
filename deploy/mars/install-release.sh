#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077
tag=${1:?Usage: bash install-release.sh vX.Y.Z}
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected a stable version tag' >&2; exit 1; }
[[ -f .env ]] || { echo 'Run bootstrap.sh first' >&2; exit 1; }
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
version=${tag#v}
release="releases/$version"
mkdir -p "$release"
base="https://github.com/waystone-workshop/waystone/releases/download/$tag"
for file in SHA256SUMS waystone-backend-linux-amd64.tar.gz waystone-website.tar.gz waystone-mars-deploy.tar.gz; do
  curl --fail --location --retry 3 "$base/$file" -o "$release/$file"
done
(
  cd "$release"
  for file in waystone-backend-linux-amd64.tar.gz waystone-website.tar.gz waystone-mars-deploy.tar.gz; do
    grep -F "  $file" SHA256SUMS
  done | sha256sum --check --strict -
)
gzip -dc "$release/waystone-backend-linux-amd64.tar.gz" | docker load
mkdir -p "$release/website" "$release/config"
tar -xzf "$release/waystone-website.tar.gz" -C "$release/website"
# The deployment umask protects secrets. Public static assets must also be
# readable by nginx's unprivileged worker inside its read-only bind mount.
find "$release/website" -type d -exec chmod 755 {} +
find "$release/website" -type f -exec chmod 644 {} +
tar -xzf "$release/waystone-mars-deploy.tar.gz" -C "$release/config"
if [[ -e website && ! -L website ]]; then
  echo 'website must be a deployment-managed symlink; preserve/move the existing directory first' >&2
  exit 1
fi
if docker compose ps --all -q backend | grep -q .; then
  docker compose stop backend
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  docker compose run --rm --no-deps --entrypoint sh backend -c \
    "mkdir -p /data/backups; if test -f /data/waystone.db; then sqlite3 /data/waystone.db '.backup /data/backups/pre-$version-$stamp.db'; fi"
  echo 'Pre-deployment SQLite backup completed.'
fi
cp compose.yaml "$release/previous-compose.yaml"
cp nginx.conf "$release/previous-nginx.conf"
cp "$release/config/compose.yaml" compose.yaml
cp "$release/config/nginx.conf" nginx.conf
ln -sfn "$release/website" website
export WAYSTONE_VERSION="$version"
deployment_started=true
trap 'if [[ "$deployment_started" == true ]]; then docker compose stop backend || true; echo "Rollout failed; backend stopped, database preserved. Inspect logs and backups." >&2; fi' ERR
if ! docker compose up -d --wait --wait-timeout 180 backend voice; then
  docker compose stop backend
  echo "Deployment failed; backend stopped. Database retained with backup. Review logs before rollback." >&2
  exit 1
fi
docker compose up -d --force-recreate website
curl --fail --retry 6 --retry-delay 2 --retry-connrefused http://127.0.0.1:8080/health
curl --fail --silent http://127.0.0.1:8080/ | grep -q 'registration-placeholder'
VERSION="$version" python3 - <<'PY'
import os,pathlib,re
p=pathlib.Path('.env')
p.write_text(re.sub(r'^WAYSTONE_VERSION=.*$', 'WAYSTONE_VERSION='+os.environ['VERSION'],p.read_text(),flags=re.M))
PY
printf '%s\n' "$tag" > current-release
deployment_started=false
for file in bootstrap.sh install-release.sh check-release.sh; do
  cp "$release/config/$file" "$file.next"
  mv "$file.next" "$file"
done
echo "Deployed $tag. Database and secrets were retained."
