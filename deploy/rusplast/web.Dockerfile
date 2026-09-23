FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --chown=node:node web/dist ./dist
COPY --chown=node:node web/dist-server ./dist-server
COPY --chown=node:node web/scripts/server.mjs ./scripts/server.mjs
COPY --chown=node:node web/package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "scripts/server.mjs"]
