FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
COPY tui/package.json tui/package.json
COPY desktop/package.json desktop/package.json
COPY cli/package.json cli/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.22.2-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3101 \
  AGENT_PROTOCOL=none \
  QWAUDIO_CONFIG_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3101
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3101/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.mjs"]
