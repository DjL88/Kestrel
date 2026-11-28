import { FTP_INBOX_PORT, FTP_INBOX_USER, ftpInboxPassword } from './ftpInboxPassword';

/**
 * Live shoot settings kept on this device, so a camera's FTP profile set up once keeps working at the next shoot: the same
 * user name, password and port each time, until the person asks for a new password. The password protects a plain FTP
 * inbox on the local network only while a live shoot is running; it is not an account secret and never leaves the device.
 */
export interface FtpCredentials { user: string; password: string; port: number }
export type LiveShootSource = 'ftp' | 'folder' | 'usb';
export interface LiveShootChoice { source: LiveShootSource; lookId: string | null; room: boolean }

export const FTP_CREDENTIALS_KEY = 'kestrel.liveShoot.ftp.v1';
export const LIVE_SHOOT_CHOICE_KEY = 'kestrel.liveShoot.choice.v1';
export const DEFAULT_LIVE_SHOOT_CHOICE: LiveShootChoice = { source: 'ftp', lookId: null, room: false };

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const PASSWORD = /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/;

export function validFtpCredentials(value: unknown): value is FtpCredentials {
  if (!value || typeof value !== 'object') return false;
  const { user, password, port } = value as Record<string, unknown>;
  return user === FTP_INBOX_USER && typeof password === 'string' && PASSWORD.test(password)
    && Number.isInteger(port) && (port as number) >= 1024 && (port as number) <= 65535;
}

function read(storage: Store | null, key: string): unknown {
  try { const text = storage?.getItem(key); return text ? JSON.parse(text) : null; } catch { return null; }
}
function write(storage: Store | null, key: string, value: unknown): void {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the values still work for this shoot */ }
}

/** This device's FTP inbox credentials: the saved ones, or new ones saved for next time. */
export function ftpCredentials(storage: Store | null, makePassword: () => string = () => ftpInboxPassword()): FtpCredentials {
  const saved = read(storage, FTP_CREDENTIALS_KEY);
  if (validFtpCredentials(saved)) return { user: saved.user, password: saved.password, port: saved.port };
  const made = { user: FTP_INBOX_USER, password: makePassword(), port: FTP_INBOX_PORT };
  write(storage, FTP_CREDENTIALS_KEY, made);
  return made;
}

/** A new password (for example after it was shared by mistake). The camera's FTP profile must then be updated. */
export function renewFtpPassword(storage: Store | null, makePassword: () => string = () => ftpInboxPassword()): FtpCredentials {
  const next = { ...ftpCredentials(storage, makePassword), password: makePassword() };
  write(storage, FTP_CREDENTIALS_KEY, next);
  return next;
}

/** The last live shoot choices on this device (source, next-capture look, client room), for the panel's starting state. */
export function readLiveShootChoice(storage: Store | null): LiveShootChoice {
  const saved = read(storage, LIVE_SHOOT_CHOICE_KEY) as Partial<LiveShootChoice> | null;
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_LIVE_SHOOT_CHOICE };
  return {
    source: saved.source === 'folder' || saved.source === 'usb' || saved.source === 'ftp' ? saved.source : DEFAULT_LIVE_SHOOT_CHOICE.source,
    lookId: typeof saved.lookId === 'string' && saved.lookId.length <= 200 ? saved.lookId : null,
    room: saved.room === true,
  };
}

export function saveLiveShootChoice(storage: Store | null, choice: LiveShootChoice): void {
  write(storage, LIVE_SHOOT_CHOICE_KEY, { source: choice.source, lookId: choice.lookId, room: choice.room });
}
