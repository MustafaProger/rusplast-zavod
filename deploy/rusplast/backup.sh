#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Manual backup only. No application stop/restart, scheduler, or remote upload.
project_dir=${RUSPLAST_PROJECT_DIR:-/opt/projects/rusplast-zavod}
env_file=${RUSPLAST_ENV_FILE:-/etc/rusplast/production.env}
backup_root=${RUSPLAST_BACKUP_ROOT:-/opt/hosting/backups}
caddy_main=${RUSPLAST_CADDY_MAIN:-/etc/caddy/Caddyfile}
caddy_site=${RUSPLAST_CADDY_SITE:-/etc/caddy/sites-enabled/rusplast.caddy}
compose_file="$project_dir/deploy/rusplast/compose.yaml"

if (( EUID != 0 )); then
  printf 'Run this backup as root so the protected environment and configuration can be read.\n' >&2
  exit 1
fi
for required in "$env_file" "$compose_file" "$project_dir/deploy/rusplast/nginx.conf" "$caddy_main" "$caddy_site"; do
  if [[ ! -f "$required" || ! -r "$required" ]]; then
    printf 'Required backup input is missing or unreadable: %s\n' "$required" >&2
    exit 1
  fi
done
for command in docker tar sha256sum mktemp install flock; do
  command -v "$command" >/dev/null || { printf 'Required command is unavailable: %s\n' "$command" >&2; exit 1; }
done

install -d -m 700 "$backup_root"
exec 9>"$backup_root/.rusplast-backup.lock"
flock -n 9 || { printf 'Another Rusplast backup is already running.\n' >&2; exit 1; }
backup_dir=$(mktemp -d "$backup_root/rusplast-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
touch "$backup_dir/INCOMPLETE"
# Keep unexpected driver/CLI diagnostics private rather than echoing credentials.
exec 3>&2
exec 2>"$backup_dir/backup.stderr"
trap 'printf "Backup failed; protected partial files remain at %s (INCOMPLETE).\n" "$backup_dir" >&3' ERR

export RUSPLAST_ENV_FILE="$env_file"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
"${compose[@]}" config --quiet
for service in db cms; do
  container=$("${compose[@]}" ps -q "$service")
  [[ -n "$container" && $(docker inspect --format '{{.State.Running}}' "$container") == true ]]
done

# PostgreSQL takes a transaction-consistent snapshot. Secrets remain inside the
# container environment; the shell command does not interpolate them on the host.
"${compose[@]}" exec -T db sh -c 'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-acl' >"$backup_dir/database.dump"
[[ -s "$backup_dir/database.dump" ]]
"${compose[@]}" exec -T db pg_restore --list <"$backup_dir/database.dump" >/dev/null

# Match the CMS runtime user; fail if the expected persistent directory is absent.
"${compose[@]}" exec -T --user node cms sh -c 'test -d /app/public/uploads && exec tar -C /app/public/uploads -czf - .' >"$backup_dir/uploads.tar.gz"
tar -tzf "$backup_dir/uploads.tar.gz" >/dev/null

install -m 600 "$env_file" "$backup_dir/production.env"
install -m 600 "$caddy_main" "$backup_dir/Caddyfile"
install -m 600 "$caddy_site" "$backup_dir/rusplast.caddy"
tar -C "$project_dir" -czf "$backup_dir/deployment-config.tar.gz" deploy/rusplast cms/config cms/package.json cms/package-lock.json

containers=$("${compose[@]}" ps -q)
[[ -n "$containers" ]]
while IFS= read -r container; do
  [[ -n "$container" ]] || continue
  docker inspect --format '{{.Name}} {{.Image}} {{.Config.Image}}' "$container"
done <<<"$containers" >"$backup_dir/images.txt"

(
  cd "$backup_dir"
  sha256sum database.dump uploads.tar.gz production.env Caddyfile rusplast.caddy deployment-config.tar.gz images.txt >SHA256SUMS
  sha256sum --check --status SHA256SUMS
)
date -u +'%Y-%m-%dT%H:%M:%SZ' >"$backup_dir/COMPLETE"
rm "$backup_dir/INCOMPLETE"
trap - ERR
printf 'Backup complete: %s\n' "$backup_dir"
printf 'Archive structure and checksums verified; perform the disposable-database restore check in BACKUP.md.\n'
