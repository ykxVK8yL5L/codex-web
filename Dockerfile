FROM node:24-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

RUN pnpm --filter @codex-web/web build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HOST=0.0.0.0
ENV PORT=8787

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git nginx procps \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && bash -lc 'set -euo pipefail; tmp="$(mktemp)"; trap "rm -f \"$tmp\"" EXIT; curl -fsSL https://mise.run -o "$tmp"; MISE_INSTALL_PATH=/usr/local/bin/mise sh "$tmp"; /usr/local/bin/mise --version' \
  && npm install -g @openai/codex pm2

COPY --from=build /app /app
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/start.sh /usr/local/bin/codex-web-start

RUN chmod +x /usr/local/bin/codex-web-start \
  && mkdir -p /app/apps/api/data /app/apps/api/restore-backups \
  && rm -f /etc/nginx/sites-enabled/default

VOLUME ["/app/apps/api/data"]

EXPOSE 5173

CMD ["codex-web-start"]
