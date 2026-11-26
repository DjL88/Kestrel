/**
 * The desktop adapter for "Edit in another app" (Rust side: `src-tauri/src/external_edit.rs`; the watcher's logic is
 * `src/core/externalEdit.ts`). A browser tab cannot open other apps or watch files, so there this is simply unavailable.
 */
import { iccDescription } from '../core/iccEmbed';
import { appFromPath, profileName, readApps, type ExternalApp, type FileStamp } from '../core/externalEdit';
import { hasNativeRaw } from './desktopShell';

/** Only the desktop app on a computer can open another app and watch its saves. */
export const externalEditorAvailable = () => hasNativeRaw();

const APPS_KEY = 'inflight.externalEditApps';

/** Apps the person chose before, on this device. */
export function loadExternalApps(): ExternalApp[] {
  try { return readApps(JSON.parse(window.localStorage.getItem(APPS_KEY) ?? '[]')); } catch { return []; }
}

export function saveExternalApps(apps: readonly ExternalApp[]): void {
  try { window.localStorage.setItem(APPS_KEY, JSON.stringify(apps)); } catch { /* remembered for this session only */ }
}

/** Ask the person to pick the app itself (an .app on a Mac, an .exe on Windows). Null when they cancel. */
export async function chooseExternalApp(): Promise<ExternalApp | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const mac = /Mac/i.test(navigator.platform);
  const windows = /Win/i.test(navigator.platform);
  const chosen = await open({
    multiple: false, directory: false, title: 'Choose the app to edit in',
    ...(mac ? { defaultPath: '/Applications', filters: [{ name: 'Apps', extensions: ['app'] }] } : {}),
    ...(windows ? { filters: [{ name: 'Apps', extensions: ['exe'] }] } : {}),
  });
  return typeof chosen === 'string' ? appFromPath(chosen) : null;
}

/** Write the rendered edit (a PNG) as a 16-bit TIFF in InFlight's working folder and open it in `app` (or the default). */
export async function sendToExternalApp(png: Blob, name: string, app: ExternalApp | null): Promise<{ path: string; stamp: FileStamp }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const headers: Record<string, string> = { 'x-file-name': encodeURIComponent(name) };
  if (app?.path) headers['x-open-with'] = encodeURIComponent(app.path);
  const answer = await invoke<{ path: string; size: number; modifiedMs: number }>('external_edit_send', new Uint8Array(await png.arrayBuffer()), { headers });
  return { path: answer.path, stamp: { size: answer.size, modifiedMs: answer.modifiedMs } };
}

/** The working file's size and modified time, or null once it has gone. */
export async function stampOf(path: string): Promise<FileStamp | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<FileStamp | null>('external_edit_stamp', { path });
}

/**
 * Read what the other app saved and write it as a 16-bit PNG InFlight can import, keeping the colour profile it saved.
 * `profile` is that profile's name (null when it saved none).
 */
export async function bringBack(path: string, name: string): Promise<{ path: string; bits: number; profile: string | null }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const answer = await invoke<{ path: string; bits: number; profile?: number[] | null }>('external_edit_bring_back', { path, name });
  const bytes = Array.isArray(answer.profile) ? Uint8Array.from(answer.profile) : null;
  return { path: answer.path, bits: answer.bits, profile: profileName(bytes ? iccDescription(bytes) : null, Boolean(bytes?.length)) };
}

/** Bits per channel of a PNG, from its header (byte 24 of IHDR). 8 when it cannot be read. */
export async function pngBitDepth(png: Blob): Promise<8 | 16> {
  const head = new Uint8Array(await png.slice(0, 25).arrayBuffer());
  return head.length === 25 && head[24] === 16 ? 16 : 8;
}
