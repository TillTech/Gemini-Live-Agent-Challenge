FROM node:22-slim

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json

RUN pnpm install --filter @tilly-live-ops/server... --frozen-lockfile

COPY apps/server apps/server

RUN pnpm --filter @tilly-live-ops/server build

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]
