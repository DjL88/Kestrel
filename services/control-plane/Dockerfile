# Build from the repository root so the shared contract in src/core is included:
#   docker build -f services/control-plane/Dockerfile -t kestrel-control-plane .
# Or in Google Cloud, without Docker locally (see infra/gcp/README.md, "Phase 2"):
#   gcloud builds submit --config services/control-plane/cloudbuild.yaml --substitutions _IMAGE=<repository>/control-plane:<tag> .
FROM node:22-alpine
WORKDIR /app
COPY src/core ./src/core
COPY services/control-plane/package.json services/control-plane/package-lock.json ./services/control-plane/
# tsx needs esbuild's platform binary, which npm installs as an optional dependency.
RUN cd services/control-plane && npm ci --include=dev --include=optional --no-audit --no-fund
COPY services/control-plane ./services/control-plane
WORKDIR /app/services/control-plane
# Cloud Run sets PORT (8080); 8787 is the local default.
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
RUN KCP_DEV_MODE=1 node --import tsx src/server.ts --print-openapi > /dev/null
CMD ["node", "--import", "tsx", "src/server.ts"]
