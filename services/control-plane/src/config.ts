import crypto from 'node:crypto';
import { loadSigningKey, type SigningKey } from './crypto.ts';

export interface Config {
  port: number;
  /** 'firestore' on Cloud Run; 'sqlite' (default) for local development and tests. */
  store: 'sqlite' | 'firestore';
  /** SQLite file, or ':memory:'. Only used when store is 'sqlite'. */
  databasePath: string;
  /** Firestore project and database; the client's defaults (the Cloud Run project, '(default)') when absent. */
  firestoreProjectId?: string;
  firestoreDatabaseId?: string;
  sessionSecret: Buffer;
  /** Signs offline grants and the data manifest. Clients pin its public half. */
  signingKey: SigningKey;
  /** Public half of the key that signs KESTREL1 licence keys (src/core/licence.ts). */
  licencePublicKey: string;
  /** Private half, only where licences are issued (admin). Absent in most deployments. */
  licencePrivateKey?: crypto.KeyObject;
  webhookSecret: string;
  /** Server-side only. Never VITE_*, never shipped to a client. */
  geminiApiKey?: string;
  geminiModel: string;
  aiTimeoutMs: number;
  allowedOrigins: string[];
  /** Hosts a desktop release notice may point at. */
  releaseHosts: string[];
  /** Development only: creates throwaway keys and an admin account. */
  devMode: boolean;
  /** Google accounts allowed into the admin console (lower-case emails). Empty: admin sessions come only from accounts with the admin role. */
  adminEmails: string[];
  /** OAuth web client id for "Sign in with Google" on /admin. Not a secret. Absent: Google sign-in is off. */
  googleClientId?: string;
  /** OAuth client ids (web, iOS, Android) accepted for people signing in with Google. Falls back to googleClientId. Not secrets. */
  userGoogleClientIds: string[];
  /** Apple Services ID (web) and app bundle ids accepted for Sign in with Apple. Not secrets. Empty: Apple sign-in is off. */
  appleClientIds: string[];
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is required outside development mode (see .env.example)`);
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const devMode = env.KCP_DEV_MODE === '1';
  const store = env.KCP_STORE === 'firestore' ? 'firestore' : 'sqlite';
  if (env.KCP_STORE && env.KCP_STORE !== 'firestore' && env.KCP_STORE !== 'sqlite') throw new Error('KCP_STORE must be sqlite or firestore');
  const licenceKeys = devMode && !env.KCP_LICENCE_PUBLIC_KEY ? crypto.generateKeyPairSync('ed25519') : null;
  const licencePrivate = env.KCP_LICENCE_PRIVATE_KEY_PEM
    ? crypto.createPrivateKey(env.KCP_LICENCE_PRIVATE_KEY_PEM)
    : licenceKeys?.privateKey;
  const licencePublic = env.KCP_LICENCE_PUBLIC_KEY ??
    (licenceKeys ? Buffer.from((licenceKeys.publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64') : required(env, 'KCP_LICENCE_PUBLIC_KEY'));
  return {
    port: Number(env.PORT ?? 8787),
    store,
    databasePath: env.KCP_DATABASE_PATH ?? (devMode || store === 'firestore' ? ':memory:' : required(env, 'KCP_DATABASE_PATH')),
    firestoreProjectId: env.KCP_FIRESTORE_PROJECT || undefined,
    firestoreDatabaseId: env.KCP_FIRESTORE_DATABASE || undefined,
    sessionSecret: env.KCP_SESSION_SECRET ? Buffer.from(env.KCP_SESSION_SECRET, 'base64') : devMode ? crypto.randomBytes(32) : Buffer.from(required(env, 'KCP_SESSION_SECRET'), 'base64'),
    signingKey: loadSigningKey(env.KCP_SIGNING_KEY_ID ?? (devMode ? 'dev' : required(env, 'KCP_SIGNING_KEY_ID')), env.KCP_SIGNING_KEY_PEM ?? (devMode ? undefined : required(env, 'KCP_SIGNING_KEY_PEM'))),
    licencePublicKey: licencePublic,
    licencePrivateKey: licencePrivate,
    webhookSecret: env.KCP_WEBHOOK_SECRET ?? (devMode ? crypto.randomBytes(24).toString('hex') : required(env, 'KCP_WEBHOOK_SECRET')),
    geminiApiKey: env.KCP_GEMINI_API_KEY || undefined,
    geminiModel: env.KCP_GEMINI_MODEL ?? 'gemini-2.5-flash',
    aiTimeoutMs: 12_000,
    allowedOrigins: (env.KCP_ALLOWED_ORIGINS ?? 'tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    releaseHosts: ['github.com'],
    devMode,
    adminEmails: (env.KCP_ADMIN_EMAILS ?? '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    googleClientId: env.KCP_GOOGLE_CLIENT_ID || undefined,
    userGoogleClientIds: (env.KCP_USER_GOOGLE_CLIENT_IDS ?? env.KCP_GOOGLE_CLIENT_ID ?? '').split(/[,\s]+/).map((v) => v.trim()).filter(Boolean),
    appleClientIds: (env.KCP_APPLE_CLIENT_IDS ?? '').split(/[,\s]+/).map((v) => v.trim()).filter(Boolean),
  };
}
