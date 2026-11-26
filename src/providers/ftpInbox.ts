import { FTP_INBOX_PORT, FTP_INBOX_USER, ftpInboxPassword } from '../core/ftpInboxPassword';
import { isDesktopApp } from './desktopShell';

/**
 * The live-shoot FTP inbox (desktop app): cameras with "FTP transfer" over Wi-Fi send each frame to this computer, into
 * a folder the person chooses, and the hot-folder watch imports it. The server itself is src-tauri/src/ftp_inbox.rs.
 */
export interface FtpInbox {
  folder: string;
  /** This computer's addresses on the local network: what to type as the camera's FTP server. */
  addresses: string[];
  port: number;
  user: string;
  password: string;
}

export const canReceiveFromCamera = () => isDesktopApp();

/** Ask for the folder, start the inbox there. Null when the person cancels. Throws with a readable reason on failure. */
export async function startFtpInbox(): Promise<FtpInbox | null> {
  if (!isDesktopApp()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const folder = await open({ directory: true, multiple: false, recursive: true, title: 'Choose the folder camera photos arrive in' });
  if (typeof folder !== 'string') return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const password = ftpInboxPassword();
  try {
    const info = await invoke<{ port: number; addresses: string[] }>('ftp_inbox_start', { folder, user: FTP_INBOX_USER, password, port: FTP_INBOX_PORT });
    return { folder, addresses: info.addresses, port: info.port, user: FTP_INBOX_USER, password };
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'The camera inbox could not start.');
  }
}

export async function stopFtpInbox(): Promise<void> {
  if (!isDesktopApp()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('ftp_inbox_stop').catch(() => undefined);
}
