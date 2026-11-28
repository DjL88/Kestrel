import { needsRefresh, type Tokens } from '../core/cloudDrive';

const PREFIX = 'kestrel.cloud-tokens.v1.';
type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function validTokens(value: unknown): value is Tokens {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<Tokens>;
  return typeof token.accessToken === 'string' && token.accessToken.length > 0 &&
    typeof token.expiresAt === 'number' && Number.isFinite(token.expiresAt) && token.expiresAt > 0 &&
    (token.refreshToken === undefined || (typeof token.refreshToken === 'string' && token.refreshToken.length > 0));
}

/**
 * Per-device-session OAuth credential lifecycle. Storage remains injectable;
 * this is not an OS keychain. A refresh is owned by the exact login that
 * started it, and cannot restore a removed connection or replace a new login.
 */
export function createOAuthTokenStore(storage: TokenStorage) {
  const memory = new Map<string, Tokens>();
  const forgotten = new Set<string>();
  const pending = new Map<string, { owner: Tokens; result: Promise<string> }>();
  function read(id: string): Tokens | null {
    if (forgotten.has(id)) return null;
    const held = memory.get(id);
    if (held) return held;
    try {
      const value: unknown = JSON.parse(storage.getItem(PREFIX + id) ?? 'null');
      if (validTokens(value)) {
        memory.set(id, value);
        return value;
      }
    } catch { /* unavailable storage is not evidence of a login */ }
    return null;
  }
  function remember(id: string, tokens: Tokens) {
    if (!validTokens(tokens)) throw new Error('The sign-in answer is invalid.');
    const value = { ...tokens };
    forgotten.delete(id);
    pending.delete(id);
    memory.set(id, value);
    try { storage.setItem(PREFIX + id, JSON.stringify(value)); } catch { /* this session only */ }
  }
  return {
    remember,
    forget(id: string) {
      forgotten.add(id);
      memory.delete(id);
      pending.delete(id);
      try { storage.removeItem(PREFIX + id); } catch { /* still disconnected for this session */ }
    },
    has(id: string) { return read(id) !== null; },
    async access(id: string, now: number, refresh: (owner: Tokens) => Promise<Tokens>): Promise<string> {
      const owner = read(id);
      if (!owner) throw new Error('Sign in again.');
      if (!needsRefresh(owner, now)) return owner.accessToken;
      if (!owner.refreshToken) throw new Error('Sign in again.');
      const inFlight = pending.get(id);
      if (inFlight?.owner === owner) return inFlight.result;
      // Defer the call until after the single-flight entry is installed.
      const result = Promise.resolve().then(async () => {
        if (read(id) !== owner) throw new Error('The connection changed. Sign in again.');
        const fresh = await refresh({ ...owner });
        if (read(id) !== owner) throw new Error('The connection changed. Sign in again.');
        remember(id, fresh);
        return fresh.accessToken;
      });
      const entry = { owner, result };
      pending.set(id, entry);
      try { return await result; }
      finally { if (pending.get(id) === entry) pending.delete(id); }
    },
  };
}
