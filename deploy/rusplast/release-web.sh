#!/usr/bin/env bash
# Frontend-only release. Caller uploads an archive of prebuilt, verified assets.
set -euo pipefail
umask 077
tag=${1:?release tag required}
archive=${2:?archive required}
[[ "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{5,80}$ ]] || exit 2
[[ "$archive" == /tmp/rusplast-web-"$tag".tar.gz ]] || exit 2
project=/opt/projects/rusplast-zavod
env_file=/etc/rusplast/production.env
exec 9>/var/lock/rusplast-web-release.lock
flock -w 180 9
release=/opt/hosting/releases/rusplast-web-$tag
[[ ! -e "$release" ]] || { echo 'Release tag already used' >&2; exit 2; }
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
rm "$archive"
test -s "$release/web/dist/index.html"
test -s "$release/web/dist/sitemap.xml"
test -s "$release/web/dist/shell.html"
test -s "$release/web/dist-server/entry-static.js"
test -s "$release/web/scripts/server.mjs"
backup=/opt/hosting/backups/rusplast-web-$tag
mkdir -p "$backup"
cp "$env_file" "$backup/production.env"
cp "$project/deploy/rusplast/compose.yaml" "$backup/compose.yaml"
docker inspect --format '{{.Config.Image}}' rusplast-web-1 > "$backup/web-image.txt"
docker inspect --format '{{.Id}}' rusplast-cms-1 > "$backup/cms-id.txt"
docker inspect --format '{{.Id}}' rusplast-db-1 > "$backup/db-id.txt"
docker build --tag "rusplast-web:$tag" --file "$release/deploy/rusplast/web.Dockerfile" "$release"
cp "$release/deploy/rusplast/compose.yaml" "$project/deploy/rusplast/compose.yaml"
compose=(docker compose --env-file "$env_file" -f "$project/deploy/rusplast/compose.yaml")
activated=false
rollback() {
  status=$?
  if [ "$activated" = true ]; then
    activated=false
    if cp "$backup/production.env" "$env_file" &&
       cp "$backup/compose.yaml" "$project/deploy/rusplast/compose.yaml" &&
       "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 90 web >&2 &&
       cmp "$backup/web-image.txt" <(docker inspect --format '{{.Config.Image}}' rusplast-web-1) &&
       curl -fsS --max-time 20 http://127.0.0.1:18081/healthz >/dev/null; then
      echo "Frontend rollback verified; backup: $backup" >&2
    else
      echo "ERROR: frontend rollback failed; manual recovery required from $backup" >&2
    fi
  fi
  exit "$status"
}
trap rollback ERR
activated=true
sed -i '/^WEB_RELEASE_TAG=/d' "$env_file"
printf '\nWEB_RELEASE_TAG=%s\n' "$tag" >> "$env_file"
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 90 web
curl -fsS --max-time 20 http://127.0.0.1:18081/ > "$release/served-index.html"
actual=$(sha256sum "$release/served-index.html" | cut -d' ' -f1)
python3 - "$release" <<'PY'
from pathlib import Path
import re, sys
root = Path(sys.argv[1])
html = (root / 'served-index.html').read_text()
shell = (root / 'web/dist/shell.html').read_text()
assert '<h1' in html and 'window.__RPZ_CONTENT__=' in html
assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', shell)
assert assets and all(asset in html for asset in assets)
PY
cmp "$backup/cms-id.txt" <(docker inspect --format '{{.Id}}' rusplast-cms-1)
cmp "$backup/db-id.txt" <(docker inspect --format '{{.Id}}' rusplast-db-1)
tls_actual=$(curl -fsS --max-time 20 --resolve rusplast-zavod.ru:443:127.0.0.1 https://rusplast-zavod.ru/ | sha256sum | cut -d' ' -f1)
test "$actual" = "$tls_actual"
for manifest in sitemap.xml publication-manifest.json; do
  curl -fsS --max-time 20 --resolve rusplast-zavod.ru:443:127.0.0.1 "https://rusplast-zavod.ru/$manifest" > "$release/served-$manifest"
done
python3 - "$release" <<'PY'
from pathlib import Path
import json, sys, xml.etree.ElementTree as ET
root = Path(sys.argv[1])
articles = json.loads((root / 'served-publication-manifest.json').read_text())['articles']
assert isinstance(articles, dict)
urls = {item.text for item in ET.fromstring((root / 'served-sitemap.xml').read_text()).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
assert 'https://rusplast-zavod.ru/' in urls
assert all('https://rusplast-zavod.ru/blog/' + slug in urls for slug in articles)
PY
activated=false
trap - ERR
printf 'DEPLOYED %s %s\n' "$tag" "$actual"
