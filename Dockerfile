# Multi-stage Dockerfile for the PrintShop API (spec §32).
# Used by Render/Docker-based deploys when not using the native runtime.
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile
RUN bun run db:generate

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/prisma ./prisma
EXPOSE 3000
CMD ["bun", "./node_modules/.bin/next", "start", "-p", "3000"]
