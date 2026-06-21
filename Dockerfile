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

ARG CFTUNNEL_VERSION=v0.8.1
ARG TARGETARCH
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV MISE_SHIMS_DIR="/root/.local/share/mise/shims"
ENV PATH="$MISE_SHIMS_DIR:/root/.local/bin:$PNPM_HOME:$PATH"
ENV HOST=0.0.0.0
ENV PORT=8787

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl tar git nginx procps \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && bash -lc 'set -euo pipefail; tmp="$(mktemp)"; trap "rm -f \"$tmp\"" EXIT; curl -fsSL https://mise.run -o "$tmp"; MISE_INSTALL_PATH=/usr/local/bin/mise sh "$tmp"; /usr/local/bin/mise --version' \
  && printf '%s\n' 'export MISE_SHIMS_DIR="${MISE_SHIMS_DIR:-$HOME/.local/share/mise/shims}"' 'case ":$PATH:" in *":$MISE_SHIMS_DIR:"*) ;; *) export PATH="$MISE_SHIMS_DIR:$HOME/.local/bin:$PATH" ;; esac' > /etc/profile.d/codex-web-mise.sh \
  && printf '%s\n' 'export MISE_SHIMS_DIR="${MISE_SHIMS_DIR:-$HOME/.local/share/mise/shims}"' 'case ":$PATH:" in *":$MISE_SHIMS_DIR:"*) ;; *) export PATH="$MISE_SHIMS_DIR:$HOME/.local/bin:$PATH" ;; esac' >> /etc/bash.bashrc \
  && npm install -g @openai/codex pm2

RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) CFTUNNEL_ARCH=amd64 ;; \
      arm64) CFTUNNEL_ARCH=arm64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/qingchencloud/cftunnel/releases/download/${CFTUNNEL_VERSION}/cftunnel_linux_${CFTUNNEL_ARCH}.tar.gz" -o /tmp/cftunnel.tar.gz; \
    tar -xzf /tmp/cftunnel.tar.gz -C /tmp; \
    install -m 755 /tmp/cftunnel /usr/local/bin/cftunnel; \
    rm -f /tmp/cftunnel.tar.gz /tmp/cftunnel

ENV CFTUNNEL_BIN=/usr/local/bin/cftunnel

COPY --from=build /app /app
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/start.sh /usr/local/bin/codex-web-start

RUN chmod +x /usr/local/bin/codex-web-start \
  && mkdir -p /app/apps/api/data /app/apps/api/restore-backups \
  && rm -f /etc/nginx/sites-enabled/default

VOLUME ["/app/apps/api/data"]

EXPOSE 5173

CMD ["codex-web-start"]
