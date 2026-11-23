# Build the real (not demo) V2 workspace, then serve all assets via
# authenticated Cloud Run. No compiled assets are copied to Firebase Hosting.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund
COPY . .
RUN npx vite build --config vite.v2proto.config.ts

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/out/v2proto /app/site
COPY services/v2proto/server.mjs /app/server.mjs
ENV NODE_ENV=production PORT=8080 V2PROTO_STATIC_ROOT=/app/site
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
