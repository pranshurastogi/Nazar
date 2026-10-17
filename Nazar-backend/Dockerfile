# Nazar backend: read API + optional pipeline worker, one image for Fly.io, Render, Railway or any Docker host.
#
#   docker build -t nazar-backend .
#   docker run -p 8787:8787 -v nazar-data:/app/data -e NAZAR_CORS_ORIGINS=https://your-app.vercel.app nazar-backend
#
# NAZAR_ROLE=api (default) | worker | all. The source is TypeScript run directly by Node 24
# (--experimental-transform-types), so there is no build step and no dev dependencies in the image.

FROM node:24-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

FROM node:24-slim AS runtime
# tini reaps children and forwards SIGTERM so the worker can finish its current document before exit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NAZAR_ROLE=api \
    NAZAR_DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=8787 \
    LOG_LEVEL=info \
    NAZAR_PUBLISH_MODE=dry-run
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY docker/entrypoint.sh /usr/local/bin/nazar-entrypoint
COPY docker/nazar /usr/local/bin/nazar
RUN chmod 0755 /usr/local/bin/nazar-entrypoint /usr/local/bin/nazar \
  && mkdir -p /app/data && chown -R node:node /app/data
# The ledger, raw documents and OCR data live here. Mount a volume to keep them across deploys.
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The entrypoint fixes ownership of a freshly mounted (root-owned) volume, then drops to the
# unprivileged `node` user before starting Node. Nothing in the app runs as root.
ENTRYPOINT ["tini", "--", "nazar-entrypoint"]
CMD ["node", "--experimental-transform-types", "--no-warnings", "src/api/main.ts"]
