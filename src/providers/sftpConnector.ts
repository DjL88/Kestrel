import { isInsideSyncRoot, isWritablePath, type StorageConnector } from '../core/storageConnectors';
import { isDesktopApp } from './desktopShell';

/**
 * A server or NAS over SFTP, in the desktop app only (a browser cannot speak SSH). The Rust side (`crates/kestrel-sftp`)
 * opens one session per call and refuses a server whose key differs from the one the person accepted.
 */
export interface SftpSettings {
  host: string;
  port: number;
  user: string;
  password?: string;
  /** An OpenSSH private key's text, used instead of the password when given. */
  privateKey?: string;
  passphrase?: string;
  /** The folder on the server InFlight works inside; empty for the sign-in's home folder. */
  root: string;
  /** The server's fingerprint the person accepted, `SHA256:...`. */
  pinned?: string;
}

type Invoke = <T>(command: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<T>;

async function tauriInvoke<T>(command: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args as Record<string, unknown>, options);
}

export const HOST_KEY_CHANGED = 'host-key-changed:';

export class SftpError extends Error {
  constructor(message: string, readonly changedKey?: string) { super(message); }
}

export const SFTP_TEXT = {
  desktopOnly: 'SFTP works in the InFlight desktop app only, because browsers cannot use it.',
  changedKey: "This server's identity has changed since you connected it. InFlight stopped, in case someone is in between. If you changed or reinstalled the server, remove this place and add it again.",
  failed: 'The SFTP connection failed. Check the address, port and sign-in.',
};

/** Turn what the Rust side said into an error with plain words. */
export function sftpFailure(error: unknown): SftpError {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (text.startsWith(HOST_KEY_CHANGED)) return new SftpError(SFTP_TEXT.changedKey, text.slice(HOST_KEY_CHANGED.length));
  return new SftpError(text || SFTP_TEXT.failed);
}

/** The problems with these settings, in words, before anything is sent. */
export function checkSftpSettings(settings: SftpSettings): string[] {
  const problems: string[] = [];
  if (!settings.host.trim() || /[\s/\\]/.test(settings.host.trim())) problems.push('Enter the server address, such as nas.example.com or 192.168.1.20.');
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) problems.push('The port is a number from 1 to 65535 (usually 22).');
  if (!settings.user.trim()) problems.push('Enter the user name.');
  if (!settings.password && !settings.privateKey?.trim()) problems.push('Enter the password, or paste a private key.');
  return problems;
}

/** Ask the server who it is, sign in and make InFlight's folder. Returns the fingerprint to show and pin. */
export async function testSftp(settings: SftpSettings, invoke: Invoke = tauriInvoke): Promise<string> {
  if (!isDesktopApp() && invoke === tauriInvoke) throw new SftpError(SFTP_TEXT.desktopOnly);
  try { return await invoke<string>('sftp_test', { target: settings }); } catch (error) { throw sftpFailure(error); }
}

export function sftpConnector(settings: SftpSettings, options: { invoke?: Invoke } = {}): StorageConnector {
  const invoke = options.invoke ?? tauriInvoke;
  const target = { ...settings };
  /** Every call but put sends the place with its arguments; put sends the bytes as the body and the rest as headers. */
  const call = async <T>(command: string, args: unknown, headers?: Record<string, string>): Promise<T> => {
    if (!options.invoke && !isDesktopApp()) throw new SftpError(SFTP_TEXT.desktopOnly);
    try { return await invoke<T>(command, args, headers ? { headers } : undefined); } catch (error) { throw sftpFailure(error); }
  };
  const guard = (path: string) => { if (!isInsideSyncRoot(path.replace(/\/+$/, ''))) throw new SftpError('Path is outside the InFlight folder.'); };

  return {
    kind: 'sftp',
    async test() {
      const problems = checkSftpSettings(settings);
      if (problems.length) return { ok: false as const, reason: problems[0] };
      if (!settings.pinned) return { ok: false as const, reason: 'Test this place again to check the server’s identity.', health: 'needs-signin' as const };
      try {
        const seen = await testSftp(settings, invoke);
        if (seen !== settings.pinned) return { ok: false as const, reason: SFTP_TEXT.changedKey, health: 'error' as const };
        return { ok: true as const };
      } catch (error) {
        const failure = error instanceof SftpError ? error : sftpFailure(error);
        if (failure.changedKey !== undefined) return { ok: false as const, reason: failure.message, health: 'error' as const };
        const signIn = /did not accept|key could not be read/i.test(failure.message);
        return { ok: false as const, reason: failure.message, health: signIn ? 'needs-signin' as const : /reach|answer/i.test(failure.message) ? 'offline' as const : 'error' as const };
      }
    },
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new SftpError('Path is outside the InFlight folder.');
      await call<void>('sftp_put', bytes, { 'x-sftp-target': encodeURIComponent(JSON.stringify(target)), 'x-sftp-path': encodeURIComponent(path) });
    },
    async get(path) {
      guard(path);
      try {
        const bytes = await call<ArrayBuffer>('sftp_get', { target, path });
        return new Uint8Array(bytes);
      } catch (error) {
        if (error instanceof SftpError && error.message === 'missing') return null;
        throw error;
      }
    },
    async list(prefix) {
      guard(prefix);
      return call<string[]>('sftp_list', { target, prefix: prefix.replace(/\/+$/, '') });
    },
    async remove(path) {
      guard(path);
      await call<void>('sftp_remove', { target, path });
    },
  };
}
