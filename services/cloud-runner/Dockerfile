# Build from the repository root so the shared pixel code in src/ is included:
#   docker build -f services/cloud-runner/Dockerfile -t kestrel-cloud-runner .
# In Google Cloud: gcloud builds submit --config services/cloud-runner/cloudbuild.yaml --substitutions _IMAGE=<repository>/cloud-runner:<tag> .
FROM node:22-alpine
WORKDIR /app
COPY src/core ./src/core
COPY src/engine ./src/engine
COPY src/providers/cloudJobCodec.ts ./src/providers/cloudJobCodec.ts
COPY services/cloud-runner/package.json services/cloud-runner/package-lock.json* ./services/cloud-runner/
RUN cd services/cloud-runner && npm install --include=dev --include=optional --no-audit --no-fund
COPY services/cloud-runner ./services/cloud-runner
WORKDIR /app/services/cloud-runner
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "src/main.ts"]
