# Build the real (not demo) V2 workspace, then serve all assets via
# authenticated Cloud Run. No compiled assets are copied to Firebase Hosting.
FROM node:24-alpine AS build
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
# Model packs and updates: the models bucket and the public manifest key (scripts/build-desktop-guard.mjs RELEASE_MODEL_SOURCE).
ARG VITE_KESTREL_MODEL_BASE_URL=https://storage.googleapis.com/kestrel-hosting-kestrel-models
ARG VITE_KESTREL_MODEL_KEYS=kestrel-2026-11=fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=
# G10: the image has no .git (.dockerignore), so the commit comes in as a build argument. With KESTREL_RELEASE=1 the build
# fails closed if it is missing or malformed (scripts/build-provenance.mjs); Cloud Build passes both (.cloudbuild/v2proto.yaml).
ARG KESTREL_BUILD_REVISION
ARG KESTREL_RELEASE=0
RUN npx vite build --config vite.v2proto.config.ts

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/out/v2proto /app/site
COPY services/v2proto/server.mjs /app/server.mjs
# The public site's origin(s) for the sign-in origin check (one config value; scripts/site/set-domain.mjs).
COPY config/public-site.json /app/config/public-site.json
ENV NODE_ENV=production PORT=8080 V2PROTO_STATIC_ROOT=/app/site
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
