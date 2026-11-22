import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type App, type AppOptions } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { AiProvider } from '../src/gateway.ts';
import { FirestoreStore } from '../src/firestoreStore.ts';
import { openStore } from '../src/openStore.ts';
import { SqliteStore } from '../src/sqliteStore.ts';
import type { Store } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

export interface Harness {
  app: App;
  url: string;
  clock: { now: number };
  call(method: string, path: string, options?: { body?: unknown; raw?: string; token?: string; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  adminToken: string;
  /** A user with a managed-AI licence, and a session token for them. */
  user: { accountId: string; token: string };
  close(): Promise<void>;
}

export function fakeProvider(overrides: Partial<AiProvider> = {}): AiProvider & { calls: number } {
  const provider = {
    name: 'fake',
    calls: 0,
    async identify() { provider.calls++; return JSON.stringify({ kind: 'wildlife', species: 'Common kingfisher', scientific: 'Alcedo atthis', confidence: 'high', tags: ['perched'] }); },
    async suggest() { provider.calls++; return JSON.stringify({ exposure: 0.3, shadows: 0.5 }); },
    async verifyColour() { provider.calls++; return JSON.stringify({ plausible: true, concerns: [], note: null }); },
    ...overrides,
  };
  return provider;
}

/**
 * Which store the tests run against: KCP_TEST_STORE=firestore uses Firestore, through the emulator when
 * FIRESTORE_EMULATOR_HOST is set (each harness gets its own project, so nothing leaks between tests), otherwise through
 * the in-memory fake in memoryFirestore.ts. Anything else is SQLite. The *.firestore.test.ts files set it.
 */
export const testStoreKind = () => (process.env.KCP_TEST_STORE === 'firestore' ? (process.env.FIRESTORE_EMULATOR_HOST ? 'firestore-emulator' : 'firestore-memory') : 'sqlite');

let harnessCount = 0;
export async function newTestStore(): Promise<Store> {
  const kind = testStoreKind();
  if (kind === 'sqlite') return new SqliteStore(':memory:');
  if (kind === 'firestore-memory') return new FirestoreStore(new MemoryFirestore());
  return openStore({ store: 'firestore', databasePath: '', firestoreProjectId: `kestrel-test-${process.pid}-${++harnessCount}` });
}

export interface HarnessExtras { env?: NodeJS.ProcessEnv; googleKeys?: AppOptions['googleKeys']; appleKeys?: AppOptions['appleKeys']; firebaseKeys?: AppOptions['firebaseKeys']; payments?: AppOptions['payments']; pricing?: AppOptions['pricing']; cloud?: AppOptions['cloud']; learning?: AppOptions['learning']; safeCopy?: AppOptions['safeCopy']; spend?: AppOptions['spend'] }

export async function startHarness(provider: AiProvider | null = fakeProvider(), commerce?: AppOptions['commerce'], extras: HarnessExtras = {}): Promise<Harness> {
  const clock = { now: Date.UTC(2026, 10, 18, 12) };
  const config = loadConfig({ KCP_DEV_MODE: '1', ...extras.env });
  const app = createApp({ config, store: await newTestStore(), provider, commerce, payments: extras.payments, pricing: extras.pricing, cloud: extras.cloud, learning: extras.learning, safeCopy: extras.safeCopy, spend: extras.spend, googleKeys: extras.googleKeys, appleKeys: extras.appleKeys, firebaseKeys: extras.firebaseKeys, now: () => clock.now });
  const server: Server = createServer((req, res) => { void app.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: Harness['call'] = async (method, path, options = {}) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: string | undefined = options.raw;
    if (options.body !== undefined) { body = JSON.stringify(options.body); headers['content-type'] = 'application/json'; }
    const response = await fetch(url + path, { method, headers, body });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };

  const adminId = await app.createAccount('admin@example.test', 'admin-password-123', 'admin');
  const adminToken = (await app.issueSession(adminId, 'admin')).accessToken;
  const userId = await app.createAccount('user@example.test', 'user-password-123', 'user');
  const issued = await call('POST', '/v1/admin/licences/issue', { token: adminToken, body: { plan: 'paid', managedAi: true, accountId: userId } });
  if (issued.status !== 200) throw new Error(`issue failed ${issued.status}`);
  const user = { accountId: userId, token: (await app.issueSession(userId, 'user')).accessToken };

  return {
    app, url, clock, call, adminToken, user,
    close: () => new Promise<void>((resolve) => { server.close(() => { void app.store.close().then(resolve); }); }),
  };
}

/** A structurally valid JPEG header (no pixel data needed: the gateway never decodes pixels). */
export function jpeg(width: number, height: number, options: { exif?: boolean; padTo?: number } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (options.exif) {
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from('MM\0*\0\0\0\x08GPS-goes-here', 'binary')]);
    parts.push(Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
  }
  parts.push(Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
  const head = Buffer.concat(parts);
  const fill = Math.max(0, (options.padTo ?? 0) - head.length - 2);
  return Buffer.concat([head, Buffer.alloc(fill, 0x55), Buffer.from([0xff, 0xd9])]);
}

export const image = (width = 640, height = 480, options: { exif?: boolean; padTo?: number } = {}) => jpeg(width, height, options).toString('base64');
