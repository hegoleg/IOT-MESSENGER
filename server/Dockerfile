# Relay server image for the monorepo.
# Build from the repository root:
#   docker build -f server/Dockerfile -t iot-messenger-relay .
# Or simply:
#   docker compose up -d --build

FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 usually ships prebuilt binaries; keep toolchain as a fallback.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web-app/package.json web-app/

RUN npm ci

COPY shared shared
COPY server server

RUN npm run build --workspace @iot/shared \
    && npm run build --workspace @iot/server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/iot.db

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]
