import { createServer } from 'node:http';
import { createApp, openApi } from './app.ts';
import { loadConfig } from './config.ts';
import { openStore } from './openStore.ts';

const config = loadConfig();
const app = createApp({ config, store: await openStore(config) });

if (process.argv.includes('--print-openapi')) {
  process.stdout.write(`${JSON.stringify(openApi(app.routes), null, 2)}\n`);
  process.exit(0);
}

if (config.devMode && process.env.KCP_DEV_ADMIN_EMAIL && process.env.KCP_DEV_ADMIN_PASSWORD) {
  await app.createAccount(process.env.KCP_DEV_ADMIN_EMAIL, process.env.KCP_DEV_ADMIN_PASSWORD, 'admin');
}

const server = createServer((req, res) => { void app.handle(req, res); });
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(config.port, () => {
  console.log(`Kestrel control plane on http://localhost:${config.port}${config.devMode ? ' (development mode: throwaway keys)' : ''}, storing data in ${app.store.kind === 'sqlite' ? `SQLite (${config.databasePath})` : 'Firestore'}`);
  console.log(`Pin this manifest/grant public key in the client: ${config.signingKey.keyId}=${config.signingKey.publicKeyBase64}`);
  if (!config.geminiApiKey) console.log('No AI provider key set: /v1/ai/* will answer AI_NOT_CONFIGURED.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { void app.store.close().finally(() => process.exit(0)); }));
}
