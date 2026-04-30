FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:3010
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/web build
ENV NODE_ENV=production
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
