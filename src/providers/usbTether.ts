import { CAMERA_VENDORS } from '../core/ptp';
import { cameraName, runTether, type TetherStatus } from '../core/ptpTether';
import { usbTransport, type UsbPipe } from '../core/ptpUsb';
import { isDesktopApp } from './desktopShell';
import { PHOTO_EXTENSION_SET } from './hotFolderWatch';

/**
 * Tethered shooting over USB (desktop app): the camera's own PTP link, no maker software needed. Each frame shot while
 * tethered is saved into a folder the person chooses, and the hot-folder watch imports it like any other live frame,
 * so USB, Wi-Fi FTP and a maker's tether app all land in the one live pipeline.
 *
 * The protocol is the shared `src/core/ptp*.ts`; this file only supplies the desktop pipe (src-tauri/src/ptp_usb.rs).
 * The workspace offers it only while this device's preview switch `kestrel.preview.usb-tether.v1` is '1' (it has been tried only against a
 * simulated camera so far).
 */
export const canTetherUsb = () => isDesktopApp();

interface NativeCamera { id: string; vendorId: number; productId: number; manufacturer?: string | null; product?: string | null }

export interface UsbTether {
  folder: string;
  camera: string;
  /** Resolves when tethering ends: undefined when stopped, the reason when the camera went away or refused. */
  ended: Promise<string | undefined>;
  stop(): void;
}

function nativePipe(invoke: typeof import('@tauri-apps/api/core').invoke, hasEvents: boolean): UsbPipe {
  const pipe: UsbPipe = {
    bulkOut: async (bytes) => { await invoke('ptp_usb_write', bytes); },
    bulkIn: async (max, timeoutMs) => new Uint8Array(await invoke<ArrayBuffer>('ptp_usb_read', { max, timeoutMs })),
    close: async () => { await invoke('ptp_usb_close').catch(() => undefined); },
  };
  if (hasEvents) {
    pipe.interruptIn = async (timeoutMs) => {
      const packet = await invoke<number[] | null>('ptp_usb_event', { timeoutMs });
      return packet ? Uint8Array.from(packet) : null;
    };
  }
  return pipe;
}

/** The cameras on USB now, by the name they give (maker and model). */
export async function listUsbCameras(): Promise<NativeCamera[]> {
  if (!isDesktopApp()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeCamera[]>('ptp_usb_list');
}

/**
 * Find the camera, ask for the folder, and start tethering. Null when there is no camera or the person cancels the
 * folder (`noCamera` says which). Throws with a readable reason when the camera cannot be opened.
 */
export async function startUsbTether(onStatus: (status: TetherStatus) => void): Promise<UsbTether | 'noCamera' | null> {
  if (!isDesktopApp()) return null;
  const cameras = await listUsbCameras();
  // Prefer a known camera maker over any other still-image device (a scanner, say).
  const camera = cameras.find((entry) => CAMERA_VENDORS[entry.vendorId]) ?? cameras[0];
  if (!camera) return 'noCamera';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const folder = await open({ directory: true, multiple: false, recursive: true, title: 'Choose the folder tethered photos are saved in' });
  if (typeof folder !== 'string') return null;
  const { invoke } = await import('@tauri-apps/api/core');
  let hasEvents: boolean;
  try { hasEvents = await invoke<boolean>('ptp_usb_open', { id: camera.id }); }
  catch (error) { throw new Error(typeof error === 'string' ? error : 'The camera could not be opened.'); }

  const controller = new AbortController();
  const label = cameraName({ manufacturer: camera.manufacturer ?? CAMERA_VENDORS[camera.vendorId] ?? '', model: camera.product ?? '' });
  const ended = runTether(usbTransport(nativePipe(invoke, hasEvents)), {
    async save(name, bytes) {
      await invoke('tether_save_frame', bytes, { headers: { 'x-folder': encodeURIComponent(folder), 'x-name': encodeURIComponent(name) } });
    },
  }, {
    signal: controller.signal,
    wanted: (name) => PHOTO_EXTENSION_SET.has(name.split('.').at(-1)?.toLowerCase() ?? ''),
    onStatus,
  }).then(
    () => undefined,
    async (error: unknown) => {
      await invoke('ptp_usb_close').catch(() => undefined);
      return controller.signal.aborted ? undefined : (error instanceof Error ? error.message : typeof error === 'string' ? error : 'The camera stopped answering.');
    },
  );
  return { folder, camera: label, ended, stop: () => controller.abort() };
}
