FROM node:20-bullseye
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/db exec prisma generate
RUN pnpm --filter @crm/db build
RUN pnpm --filter @crm/gateway build
ENV NODE_ENV=production
CMD ["node", "apps/gateway/dist/main.js"]
