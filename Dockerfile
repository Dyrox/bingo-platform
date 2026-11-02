# One image: the backend (API under /api) also serves the built website and the reporter download.
# CI puts the reporter jar + reporter.json in ./downloads before building (see .github/workflows/deploy.yml).

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
# tsx (a dev dependency) runs the TypeScript directly, so keep dev dependencies
RUN npm ci
COPY backend/ ./
COPY --from=web /web/dist ./web-dist
COPY downloads/ ./web-dist/downloads/
ENV NODE_ENV=production WEB_DIST=/app/web-dist PORT=3100
EXPOSE 3100
CMD ["npx", "tsx", "src/server.ts"]
