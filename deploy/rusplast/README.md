# Rusplast production stack

Host Caddy owns ports 80/443 and routes the domains:

| Domain / path | Loopback service |
| --- | --- |
| `rusplast-zavod.ru` | `127.0.0.1:18081` (nginx and prebuilt frontend) |
| `rusplast-zavod.ru/api/*`, `/uploads/*` | nginx forwards to CMS inside this stack |
| `cms.rusplast-zavod.ru` | `127.0.0.1:18082` (Strapi including admin/plugin routes) |

PostgreSQL has no host port and uses an internal network. The application network
allows the CMS to reach SMTP. Both database and uploaded files use persistent,
project-scoped volumes. Other projects should use their own Compose name, network,
volumes and loopback ports. Caddy must replace untrusted forwarding headers; nginx
preserves its single client IP. Do not expose ports 18081/18082 through the firewall.

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

Upload source and `web/dist` to the release directory. Exclude local `.env`,
`node_modules`, `.tmp`, Git metadata and local uploads/database files from source
transfer. Docker build contexts additionally use explicit allowlists.

Before each build, set a new `RELEASE_TAG` in `/etc/rusplast/production.env`, for
example `20260923T120000Z-a1b2c3d`. Never reuse a tag, including for a rebuild of
the same commit. Do not deploy the placeholder from the example file.

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
1 GiB CMS, 512 MiB database and 128 MiB nginx. These limits do not cap the Docker
build itself; build one project at a time and check host headroom first.

Do not publish the CMS host or remove its Caddy access gate until the production
administrator is established and data is verified. `PUBLIC_URL` is part of the
compiled admin bundle, so changing it requires rebuilding the CMS image. The
separate CMS hostname keeps Strapi's admin and plugin routes intact without an
ever-growing allowlist on the public website. The frontend uses same-origin API
and upload paths, so it does not need cross-origin access for its public requests.

## Verify and maintain

```sh
docker compose --env-file /etc/rusplast/production.env -f deploy/rusplast/compose.yaml ps
curl --fail --silent --output /dev/null http://127.0.0.1:18081/
curl --fail --silent --output /dev/null http://127.0.0.1:18081/api/products
curl --fail --silent --output /dev/null http://127.0.0.1:18082/_health
```

Verify canonical redirects and genuine unknown-path 404s via the public HTTPS
origin after Caddy is configured. Test lead persistence and SMTP only with an
explicitly authorized test submission. An accepted SMTP send does not prove
inbox delivery. Docker health checks measure liveness; they are not off-host
monitoring or automatic recovery from an unhealthy (still running) process.

Before upgrades, back up PostgreSQL with `pg_dump` and the uploads volume together,
store copies off-host and check restoration. Keep production secrets in a separate
protected backup. Do not use `docker compose down --volumes` during ordinary
releases. Database migrations require a database restore for a full rollback;
reverting just the image is not always sufficient.

Strapi references:

- [Server URL and trusted proxy configuration](https://docs.strapi.io/cms/configurations/server)
- [Production Docker builds](https://docs.strapi.io/cms/installation/docker)
- [PostgreSQL configuration](https://docs.strapi.io/cms/configurations/database)
