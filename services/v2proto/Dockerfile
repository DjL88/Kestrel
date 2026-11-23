# Build the real (not demo) V2 workspace, then serve all assets via
# authenticated Cloud Run. No compiled assets are copied to Firebase Hosting.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund
COPY . .
# Public settings consumed by Vite during the build. The gateway gets its
# signing secret and owner allow-list separately when it starts.
ARG V2PROTO_REQUIRE_ONLINE_CONFIG=false
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_KESTREL_CONTROL_PLANE_URL
ARG VITE_KESTREL_GRANT_KEYS
RUN npx vite build --config vite.v2proto.config.ts

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/out/v2proto /app/site
COPY services/v2proto/server.mjs /app/server.mjs
ENV NODE_ENV=production PORT=8080 V2PROTO_STATIC_ROOT=/app/site
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
