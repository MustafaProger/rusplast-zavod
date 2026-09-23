#!/usr/bin/env bash
set -euo pipefail

# One-time bootstrap only. Later changes use caddy validate + systemctl reload.
# Reject an existing edge before creating backups or changing any configuration.
if systemctl is-active --quiet caddy; then
    echo 'Caddy is already active; refusing one-time edge activation. Use validate/reload.' >&2
    exit 1
fi
python3 - <<'PY'
from pathlib import Path
s = Path('/opt/fuellead/compose.production.yml').read_text()
if '127.0.0.1:18080:80' in s:
    raise SystemExit('FuelLead already uses the edge port; refusing repeat activation.')
if s.count('      - "80:80"') != 1:
    raise SystemExit('Unexpected initial frontend port configuration; stopping.')
PY

install -d -m 700 /opt/hosting/backups
backup="$(mktemp -d "/opt/hosting/backups/edge-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
cp -a /opt/fuellead/compose.production.yml "$backup/compose.production.yml"
cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"
if [ -e /etc/caddy/sites-enabled/fuellead.caddy ] || [ -L /etc/caddy/sites-enabled/fuellead.caddy ]; then
    cp -a /etc/caddy/sites-enabled/fuellead.caddy "$backup/fuellead.caddy"
fi
caddy_was_enabled="$(systemctl is-enabled caddy || true)"
docker inspect fuellead-backend-1 fuellead-imap-worker-1 fuellead-db-1 \
    --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' > "$backup/containers-before.txt"
curl --fail --silent http://127.0.0.1/ > "$backup/fuellead-before.html"

rollback() {
    failure=$?
    trap - ERR
    set +e
    echo 'Edge activation failed; restoring the previous FuelLead port.' >&2
    systemctl stop caddy
    if [ "$caddy_was_enabled" != enabled ]; then
        systemctl disable caddy
    fi
    cp -a "$backup/compose.production.yml" /opt/fuellead/compose.production.yml
    cp -a "$backup/Caddyfile" /etc/caddy/Caddyfile
    if [ -e "$backup/fuellead.caddy" ] || [ -L "$backup/fuellead.caddy" ]; then
        cp -a "$backup/fuellead.caddy" /etc/caddy/sites-enabled/fuellead.caddy
    else
        rm -f /etc/caddy/sites-enabled/fuellead.caddy
    fi
    docker compose --project-directory /opt/fuellead \
        -f /opt/fuellead/docker-compose.yml -f /opt/fuellead/compose.production.yml \
        up -d --no-deps --no-build frontend
    echo "Restore attempted; inspect service state and backup: $backup" >&2
    exit "$failure"
}
trap rollback ERR

install -d -m 755 /etc/caddy/sites-enabled
install -m 644 /opt/hosting/Caddyfile /etc/caddy/Caddyfile
install -m 644 /opt/hosting/fuellead.caddy /etc/caddy/sites-enabled/fuellead.caddy
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/sites-enabled/fuellead.caddy
caddy validate --config /etc/caddy/Caddyfile

python3 - <<'PY'
from pathlib import Path
p = Path('/opt/fuellead/compose.production.yml')
s = p.read_text()
old = '      - "80:80"'
new = '      - "127.0.0.1:18080:80"'
if new not in s:
    if s.count(old) != 1:
        raise SystemExit('Unexpected frontend port configuration; stopping')
    p.write_text(s.replace(old, new))
PY
docker compose --project-directory /opt/fuellead \
    -f /opt/fuellead/docker-compose.yml -f /opt/fuellead/compose.production.yml \
    config --quiet
docker compose --project-directory /opt/fuellead \
    -f /opt/fuellead/docker-compose.yml -f /opt/fuellead/compose.production.yml \
    up -d --no-deps --no-build frontend
systemctl restart caddy

for attempt in $(seq 1 15); do
    if curl --fail --silent http://127.0.0.1/ > "$backup/fuellead-after.html"; then
        break
    fi
    sleep 1
done
cmp "$backup/fuellead-before.html" "$backup/fuellead-after.html"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H 'Host: unknown.invalid' http://127.0.0.1/)" = 404
docker inspect fuellead-backend-1 fuellead-imap-worker-1 fuellead-db-1 \
    --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' > "$backup/containers-after.txt"
cmp "$backup/containers-before.txt" "$backup/containers-after.txt"
systemctl enable caddy
trap - ERR
echo "Edge active; FuelLead HTML and backend/worker/database unchanged. Backup: $backup"
