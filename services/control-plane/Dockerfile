# Build from the repository root so the shared contract in src/core is included:
#   docker build -f services/control-plane/Dockerfile -t kestrel-control-plane .
FROM node:22-alpine
WORKDIR /app
COPY src/core ./src/core
COPY services/control-plane/package.json ./services/control-plane/package.json
RUN cd services/control-plane && npm install --omit=optional --no-audit --no-fund && npm install --no-save tsx@4 --no-audit --no-fund
COPY services/control-plane ./services/control-plane
WORKDIR /app/services/control-plane
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["npx", "tsx", "src/server.ts"]
