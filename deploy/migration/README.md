# Initial content migration

These helpers preserve the current local catalog, both draft and published
records, saved leads, and the existing administrator password. They never submit
lead forms or send email. The official content export omits `admin::` entities;
the separate administrator file contains bcrypt hashes and is confidential.

From the repository root:

```sh
node deploy/migration/export-local.cjs
```

The script makes an online-consistent SQLite snapshot with `better-sqlite3`
backup, exports that isolated copy using the installed Strapi CLI, and verifies
archive entity counts against the snapshot. It prints the private output path
under `cms/.tmp/transfer/`. The source database is not modified. Generated files
use mode `0600` and the output directory uses `0700`; `.tmp` is Git-ignored.
Keep the whole directory in private backup storage. Transfer only the archive,
`admins.json`, and `manifest.json` to a root-controlled directory on the server.

On the server, stop the new CMS application and run the import in a one-off
container configured for its **fresh PostgreSQL database**, using the same
Strapi version and content schemas. The official import clears target content;
never use it against an existing production database. Existing bootstrap seed
records in the new database are expected and are replaced by imported content.
Mount the private transfer directory read-only at `/migration-data` and this
script directory at `/migration-tools` for these one-off commands:

```sh
# Working directory must be the CMS project, with production environment loaded.
npm run strapi -- import --file /migration-data/content.tar.gz --force
node /migration-tools/import-admins.cjs /migration-data/admins.json /migration-data/manifest.json
```

The admin helper requires PostgreSQL, the source Strapi version, matching target
content counts and the admin-file checksum. It maps the super-admin role by its
code and inserts the existing bcrypt hash through the database query API so the
hash is not hashed again. Re-running it on identical admin credentials is a
no-op; it refuses to overwrite different accounts. It does not migrate session,
reset, or invitation tokens. No plaintext administrator password is needed.

Do not expose the CMS publicly until the administrator import succeeds. Start
CMS and verify `/admin/init` reports `hasAdmin: true`, API catalog count matches,
public lead listing and product writes return 403, and an invalid lead POST
returns 400. Never use a valid lead payload in a production smoke test because
that sends an email through the real SMTP account.

Preserve existing image fields. The frontend intentionally selects generated
product illustrations by SKU in `web/src/lib/product-presentation.ts`.
