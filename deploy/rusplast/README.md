# Rusplast production stack

This describes the updated CMS-backed Node configuration. Deployment and public
verification are recorded separately in the release report; building locally does
not establish that the public domain is running this version.

Host Caddy owns ports 80/443 and routes the domains:

| Domain / path | Loopback service |
| --- | --- |
| `rusplast-zavod.ru` | `127.0.0.1:18081` → Node web port `8080` inside Compose |
| `rusplast-zavod.ru/api/*` | Node forwards allowed public content reads and lead creation to `http://cms:1337` |
| `rusplast-zavod.ru/uploads/*` | Node redirects to the public CMS media URL |
| `cms.rusplast-zavod.ru` | `127.0.0.1:18082` (Strapi including admin/plugin routes) |

PostgreSQL has no host port and uses an internal network. The application network
allows the CMS to reach SMTP. Both database and uploaded files use persistent,
project-scoped volumes. Other projects should use their own Compose name, network,
volumes and loopback ports. Caddy must replace untrusted forwarding headers; the
Node API forwarding layer passes that client IP to the CMS. Do not expose ports
18081/18082 through the firewall.

## Content at runtime

The web container runs `scripts/server.mjs` on Node 22, rather than serving only
prebuilt HTML through nginx. `CMS_INTERNAL_URL=http://cms:1337` supplies live
published products, articles, documents and site images over the Compose network.
`CMS_PUBLIC_URL` supplies the public HTTPS origin for Media Library links; its
default in Compose follows `PUBLIC_URL=https://cms.rusplast-zavod.ru`.

`CONTENT_CACHE_MS=15000` limits the server content cache to 15 seconds. A new page
request after that interval reads the latest published content. HTML, article
routes, `/sitemap.xml` and `/publication-manifest.json` therefore update after
CMS publication without rebuilding web. An already open browser tab needs a
refresh to observe the change. Drafts are not published content. On a failed CMS
refresh the runtime returns 503 instead of resurrecting articles from the build
snapshot. `/healthz` checks Node liveness and does not verify CMS availability.

`npm run cms:sync --prefix web` refreshes a local build/offline snapshot; it does
not publish or import records into CMS. The initial transfer is a separate,
explicit operation described in [CONTENT-MIGRATION.md](../../cms/CONTENT-MIGRATION.md).
Automatic seeding on CMS startup is disabled. Editor instructions are in
[CMS_CONTENT.md](../../docs/CMS_CONTENT.md); operator publishing is described in
[SEO_AUTOPUBLISH.md](../../docs/SEO_AUTOPUBLISH.md).

## Build and start

Keep production secrets outside Git at `/etc/rusplast/production.env` (mode `600`).
Use `production.env.example` as a checklist. Provide two or more independently
generated comma-separated `APP_KEYS` and an independent random value for every
other secret. Import any existing database/uploads before exposing the new CMS;
retain the matching secrets where imported data depends on them.

From the repository root, first build the frontend on the workstation/CI:

```sh
VITE_CMS_URL=https://rusplast-zavod.ru npm run build --prefix web
```

Upload source and **both** `web/dist` and `web/dist-server` to the release
directory. The web image also needs `web/scripts/server.mjs` and
`web/package.json`, plus its Dockerfile and Docker build-context allowlist.
The build must include `dist/shell.html` and `dist-server/entry-static.js`.
A `dist`-only transfer or the old `deploy/nginx-static.conf.example` cannot run
this architecture. `npm run preview --prefix web` remains a static snapshot
preview; `npm run start --prefix web` runs the CMS-backed Node server.

Exclude local `.env`, `node_modules`, `.tmp`, Git metadata and local
uploads/database files from source transfer. Docker build contexts additionally
use explicit allowlists.

Before each build, set a new `RELEASE_TAG` in `/etc/rusplast/production.env`, for
example `20260923T120000Z-a1b2c3d`. Never reuse a tag, including for a rebuild of
the same commit. If `WEB_RELEASE_TAG` is already set from a web-only release,
update it to the new web tag for a full release as well; otherwise it overrides
`RELEASE_TAG` for the web image. Do not deploy the placeholder from the example
file.

Before changing that env file, retain the previous tag and its exact images,
release source/Compose configuration, Caddy site configuration, and a protected
copy of its external env file (mode `600`, outside Git). Store them under a
release-specific directory, and keep them until the new release is verified.
Avoid image pruning that would remove those rollback images.

For an application-only rollback, use that previous release's Compose file and
external env file with `up -d --no-build --wait`, then verify the site and API.
Set `RUSPLAST_ENV_FILE` to the retained env file as well as passing `--env-file`,
so both Compose interpolation and the CMS receive the matching values. If the
release migrated the database, follow the database restoration procedure first;
an older image alone is not a complete rollback.

On the server, validate without printing interpolated secrets and build sequentially:

```sh
docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml config --quiet
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml build cms
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml build web
docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml up -d --wait
```

Set `RUSPLAST_ENV_FILE=/absolute/custom.env` as well as `--env-file` if the secret
file is at another location. Strapi builds on Debian/Node 22; its build has a
1,408 MiB JavaScript heap and two native compiler workers. Runtime limits are
1 GiB CMS, 512 MiB database and 256 MiB Node web. These limits do not cap the Docker
build itself; build one project at a time and check host headroom first.

Do not publish the CMS host or remove its Caddy access gate until the production
administrator is established and data is verified. `PUBLIC_URL` is part of the
compiled admin bundle, so changing it requires rebuilding the CMS image. The
separate CMS hostname keeps Strapi's admin and plugin routes intact without an
ever-growing allowlist on the public website. The browser can use the same-origin
public API through the Node forwarding layer. Media links use the public CMS hostname. The forwarding layer only exposes
published content reads and lead creation; CMS administration and file uploading
remain on the authenticated CMS hostname.

## Web-only releases

Once the new CMS schemas, content migration and compatible web runtime are in
place, `release-web.sh` can update the web application without restarting the
CMS or database. It does not migrate schemas, import content or deploy a changed
consent contract to CMS; those changes need a coordinated application release.
Ordinary article, image or PDF edits in the existing CMS schema do not need this
script at all.

Build and verify web locally, choose a new never-used release tag, and upload
`/tmp/rusplast-web-<tag>.tar.gz`. The archive must contain these paths relative
to its root:

- `web/dist/` and `web/dist-server/`;
- `web/scripts/server.mjs` and `web/package.json`;
- `deploy/rusplast/web.Dockerfile` and `deploy/rusplast/web.Dockerfile.dockerignore`;
- the compatible `deploy/rusplast/compose.yaml`.

Run on the server with the chosen tag in `tag`:

```sh
bash /opt/projects/rusplast-zavod/deploy/rusplast/release-web.sh "$tag" "/tmp/rusplast-web-$tag.tar.gz"
```

The script serializes web releases, refuses a previously used tag, retains the
previous environment/Compose/image reference in
`/opt/hosting/backups/rusplast-web-<tag>`, builds the new Node image and switches
only the web service via `WEB_RELEASE_TAG`. It then checks:

- loopback HTML contains an H1, the CMS content payload and assets from the new
  build's shell;
- CMS and database container identities did not change;
- the HTTPS page served through host Caddy matches the observed loopback HTML;
- the publication manifest parses and every listed article appears in sitemap.

The first check is semantic: live HTML is not expected to have the same hash as
the static `dist/index.html` build snapshot. The emitted `DEPLOYED <tag> <sha256>`
hash identifies the HTML actually served during verification. Artifacts fetched
for these checks remain in `/opt/hosting/releases/rusplast-web-<tag>`.

On a failure after activation, the script attempts to restore the previous web
environment, Compose configuration and image, verifies that image and its
`/healthz`, and reports whether rollback succeeded. It does not restore CMS data
or independently prove all previous pages after rollback; investigate any
reported rollback failure using the retained backup.

## Verify and maintain

```sh
docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml ps
curl --fail --silent --output /dev/null http://127.0.0.1:18081/
curl --fail --silent --output /dev/null http://127.0.0.1:18081/api/products
curl --fail --silent --output /dev/null http://127.0.0.1:18081/sitemap.xml
curl --fail --silent --output /dev/null http://127.0.0.1:18081/publication-manifest.json
curl --fail --silent --output /dev/null http://127.0.0.1:18082/_health
```

Verify canonical redirects and genuine unknown-path 404s via the public HTTPS
origin after Caddy is configured. Check an article's full HTML, its CMS image and
a PDF; verify publication changes in both the page and sitemap after the cache
interval. Confirm drafts are excluded and customer leads cannot be publicly
read. `release-web.sh` checks runtime structure and manifest consistency; it does
not replace these content and browser checks. Test lead persistence and SMTP
only with an explicitly authorized test submission. An accepted SMTP send does not prove
inbox delivery. Docker health checks measure liveness; they are not off-host
monitoring or automatic recovery from an unhealthy (still running) process.

Before upgrades, back up PostgreSQL with `pg_dump` and the uploads volume together,
store copies off-host and check restoration. Keep production secrets in a separate
protected backup. Do not use `docker compose down --volumes` during ordinary
releases. Database migrations require a database restore for a full rollback;
reverting just the image is not always sufficient.

The new privacy/consent contract and unresolved organizational requirements are
documented in [PRIVACY_REVIEW-2026-09-23.md](../../docs/PRIVACY_REVIEW-2026-09-23.md).
A deployment or a backup does not establish compliant retention, registration
with Roskomnadzor or the physical location of every stored copy.

Strapi references:

- [Server URL and trusted proxy configuration](https://docs.strapi.io/cms/configurations/server)
- [Production Docker builds](https://docs.strapi.io/cms/installation/docker)
- [PostgreSQL configuration](https://docs.strapi.io/cms/configurations/database)
