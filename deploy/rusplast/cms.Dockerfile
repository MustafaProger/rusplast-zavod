# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build

# Native modules have prebuilt binaries on Debian; keep a bounded fallback compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV npm_config_jobs=2 MAKEFLAGS=-j2 UV_THREADPOOL_SIZE=2 \
    STRAPI_TELEMETRY_DISABLED=true STRAPI_DISABLE_UPDATE_NOTIFICATION=true
COPY cms/package.json cms/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY cms/config ./config
COPY cms/src ./src
COPY cms/types ./types
COPY cms/tsconfig.json cms/favicon.png ./
COPY cms/public/robots.txt ./public/robots.txt

# Only this public URL is compiled into the admin bundle. No runtime secrets enter
# the build context or layers. Change PUBLIC_URL only together with a rebuild.
ARG PUBLIC_URL=https://cms.rusplast-zavod.ru
ENV NODE_ENV=production PUBLIC_URL=${PUBLIC_URL} NODE_OPTIONS=--max-old-space-size=1408
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
    && mkdir -p public/uploads

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=1337 \
    STRAPI_TELEMETRY_DISABLED=true STRAPI_DISABLE_UPDATE_NOTIFICATION=true
COPY --from=build --chown=node:node /app ./
# WORKDIR creates the parent as root; COPY --chown only owns copied children.
# Strapi also creates migration/temp/cache paths beside dist at runtime.
RUN chown node:node /app
USER node
RUN mkdir -p database/migrations .tmp .cache .strapi public/uploads
EXPOSE 1337
CMD ["npm", "run", "start"]
