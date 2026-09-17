FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig*.json vite.config.ts ./
RUN npm ci
COPY backend ./backend
COPY shared ./shared
COPY frontend ./frontend
COPY scripts/prerender-landing.mjs ./scripts/prerender-landing.mjs
RUN npm run build
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY backend/db/migrations ./backend/db/migrations
COPY public ./public
COPY docs/cards.json ./docs/cards.json
COPY resources ./resources
COPY deploy/render/start.sh ./deploy/render/start.sh
ENV CHROME_PATH=/usr/bin/chromium
USER node
CMD ["node","dist/backend/http/server.js"]
