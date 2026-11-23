# Lumen Reach: game + server in one image. Build: docker compose build
FROM node:22-alpine AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/lumen.db STATIC_DIR=/srv/public
COPY --from=server /srv/package.json ./
COPY --from=server /srv/node_modules ./node_modules
COPY --from=server /srv/dist ./dist
COPY --from=client /app/dist ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
