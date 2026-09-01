FROM node:24.11.1-alpine

WORKDIR /app

ENV COREPACK_HOME=/opt/corepack

RUN mkdir -p "${COREPACK_HOME}" \
  && corepack enable \
  && corepack prepare pnpm@10.34.5 --activate \
  && chmod -R a+rX "${COREPACK_HOME}"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY workers ./workers

RUN pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://localhost:5432/unused pnpm --filter @bet-stats/database prisma version
RUN chown -R node:node /app/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines
RUN pnpm build

ENV NODE_ENV=production

USER node
