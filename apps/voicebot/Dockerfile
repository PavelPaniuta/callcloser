FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/voicebot build
ENV NODE_ENV=production
CMD ["node", "apps/voicebot/dist/index.js"]
