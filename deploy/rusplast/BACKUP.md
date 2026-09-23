# Manual backup and restoration check

On the server, run as root:

```sh
bash /opt/projects/rusplast-zavod/deploy/rusplast/backup.sh
```

The script makes no schedules, remote uploads, service restarts, or production
database changes. Its defaults are the project at `/opt/projects/rusplast-zavod`,
secrets at `/etc/rusplast/production.env`, and output beneath
`/opt/hosting/backups/rusplast-<UTC timestamp>-<random suffix>`. All backup files
are private (`0600`) within a `0700` directory. It stops on a missing required
input; failure leaves an `INCOMPLETE` marker and private diagnostics. Only a
directory with `COMPLETE` and valid `SHA256SUMS` is a completed backup.

Each backup contains:

- `database.dump`: PostgreSQL custom-format, consistent database snapshot,
  including products, leads and admin credentials;
- `uploads.tar.gz`: persistent uploads, read as the CMS runtime user;
- `production.env`: secrets, stored separately from the content archives;
- `Caddyfile`, `rusplast.caddy`: host routing configuration;
- `deployment-config.tar.gz`: deployment files, CMS configuration and dependency
  manifests;
- `images.txt`: running image references and exact image IDs, without container
  environment values.

The uploads archive and database snapshot are separate operations. Avoid CMS
media additions/deletions and content changes during this brief backup window
when an exactly matching pair is needed. The script does not block writers.
Keep the matching immutable application images and full source release as well;
the configuration archive alone does not contain the whole website or Docker
images. Copy completed backups to protected off-host storage separately.

## Verify restoration without touching production

Set `backup_dir` to the exact completed directory printed by the script. Run the
following from a root Bash shell. This uses a fresh temporary database on the
same PostgreSQL service and never restores over the live database.

```bash
set -Eeuo pipefail
umask 077
backup_dir=/opt/hosting/backups/rusplast-REPLACE-WITH-EXACT-DIRECTORY
test -f "$backup_dir/COMPLETE"
test ! -e "$backup_dir/INCOMPLETE"
(cd "$backup_dir" && sha256sum --check --status SHA256SUMS)

export RUSPLAST_ENV_FILE=/etc/rusplast/production.env
compose=(docker compose --env-file "$RUSPLAST_ENV_FILE" -f /opt/projects/rusplast-zavod/deploy/rusplast/compose.yaml)
verify_db="rusplast_restorecheck_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
[[ "$verify_db" =~ ^rusplast_restorecheck_[0-9]+_[0-9]+$ ]]

"${compose[@]}" exec -T db sh -c '
  test "$1" != "$POSTGRES_DB" &&
  exec createdb --username "$POSTGRES_USER" --maintenance-db postgres "$1"
' sh "$verify_db"

"${compose[@]}" exec -T db sh -c '
  test "$1" != "$POSTGRES_DB" &&
  exec pg_restore --username "$POSTGRES_USER" --dbname "$1" --no-owner --no-acl --exit-on-error
' sh "$verify_db" <"$backup_dir/database.dump"

# Counts only: do not print saved contacts, credential hashes or secret values.
"${compose[@]}" exec -T db sh -c '
  exec psql --username "$POSTGRES_USER" --dbname "$1" --no-psqlrc --set ON_ERROR_STOP=1
' sh "$verify_db" <<'SQL'
SELECT 'products' AS entity, count(*) FROM products
UNION ALL SELECT 'published_products', count(*) FROM products WHERE published_at IS NOT NULL
UNION ALL SELECT 'leads', count(*) FROM leads
UNION ALL SELECT 'admin_users', count(*) FROM admin_users
UNION ALL SELECT 'uploads', count(*) FROM files;
SQL

# Check the uploads archive in a disposable, protected directory as well.
verify_files=$(mktemp -d /opt/hosting/backups/.rusplast-uploads-check-XXXXXX)
tar -xzf "$backup_dir/uploads.tar.gz" -C "$verify_files" --no-same-owner
find "$verify_files" -type f | wc -l

# Explicitly remove only the temporary database just created above.
[[ "$verify_db" =~ ^rusplast_restorecheck_[0-9]+_[0-9]+$ ]]
"${compose[@]}" exec -T db sh -c '
  test "$1" != "$POSTGRES_DB" &&
  exec dropdb --username "$POSTGRES_USER" --maintenance-db postgres "$1"
' sh "$verify_db"
case "$verify_files" in
  /opt/hosting/backups/.rusplast-uploads-check-*) rm -r -- "$verify_files" ;;
  *) printf 'Unexpected temporary path; refusing cleanup.\n' >&2; exit 1 ;;
esac
```

If a command fails, leave the temporary database/files for investigation and
remove them explicitly after fixing the problem. A successful `pg_restore` plus
the expected row counts and uploads extraction provides actual restore evidence;
an archive listing or checksum alone does not.

## Recovery

Prefer restoring into a fresh project-scoped PostgreSQL volume/database and a
fresh uploads volume, then starting the corresponding retained CMS/web images
with the backed-up environment in an isolated stack. Verify content, admin
access, catalog API and forms using invalid submissions (valid submissions send
real email). Switch routing only after those checks. Keep the original stack
and volumes until recovery is verified. Do not run `down --volumes` or use
`pg_restore --clean` against the live database as a routine restoration step.
