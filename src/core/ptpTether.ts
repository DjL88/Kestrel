import { PTP_EVENT, PTP_FORMAT_ASSOCIATION, PTP_OP, PTP_RESPONSE, PtpError, parseDeviceInfo, parseNikonEvents, parseObjectInfo, responseName, type PtpDeviceInfo, type PtpEvent } from './ptp';
import type { PtpRequest, PtpResponse, PtpTransport } from './ptpUsb';

/**
 * Tethered shooting over PTP: open a session, wait for the camera to say a new photo exists, fetch it whole and hand it
 * to `save`, which writes it into the live-shoot folder the hot-folder watch imports from. Shared by every transport.
 *
 * Read-only towards the camera: it never deletes, formats, changes a setting or fires the shutter. Photos already on the
 * card before tethering started are left alone; only frames taken while tethered are fetched.
 */
export interface TetherSink {
  /** Write one frame; resolves once the file is complete on disk. */
  save(name: string, bytes: Uint8Array): Promise<void>;
}

export interface TetherStatus {
  /** "Nikon Z 8", as the camera names itself. */
  camera: string;
  saved: number;
  /** The file being fetched now and how far along, or null when waiting for the next shot. */
  fetching: { name: string; received: number; total: number } | null;
  /** How the camera tells InFlight about new shots, for the support log. */
  events: 'interrupt' | 'nikon' | 'poll';
}

export interface TetherOptions {
  signal: AbortSignal;
  /** Only these files are fetched (photos); videos and sidecars stay on the card. */
  wanted: (filename: string) => boolean;
  onStatus?: (status: TetherStatus) => void;
  /** Called once the session is open, with what the camera says about itself. */
  onConnected?: (info: PtpDeviceInfo) => void;
  /** How long to wait between looks when the camera has to be asked (Nikon, or no event pipe). */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const NIKON_SDRAM_HANDLE = 0xffff0001;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function cameraName(info: Pick<PtpDeviceInfo, 'manufacturer' | 'model'>): string {
  const model = info.model.trim();
  const maker = info.manufacturer.trim().split(/\s+/)[0] ?? '';
  if (!model) return maker || 'Camera';
  return maker && !model.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${model}` : model;
}

/** Runs until `signal` aborts (then closes the session) or the camera goes away (then rejects with the reason). */
export async function runTether(transport: PtpTransport, sink: TetherSink, options: TetherOptions): Promise<void> {
  const sleep = options.sleep ?? realSleep;
  const pollMs = options.pollMs ?? 300;
  const { signal } = options;

  async function call(request: PtpRequest, extra?: Parameters<PtpTransport['transact']>[1]): Promise<PtpResponse> {
    for (let attempt = 0; ; attempt++) {
      const response = await transport.transact(request, extra);
      // A camera busy writing to its card says so; wait a moment rather than give up on the frame.
      if (response.code === PTP_RESPONSE.DeviceBusy && attempt < 50 && !signal.aborted) { await sleep(100); continue; }
      return response;
    }
  }
  function ok(response: PtpResponse, what: string): PtpResponse {
    if (response.code !== PTP_RESPONSE.OK) throw new PtpError(`The camera refused to ${what} (${responseName(response.code)}).`, response.code);
    return response;
  }

  const info = parseDeviceInfo(ok(await call({ code: PTP_OP.GetDeviceInfo }), 'describe itself').data);
  const opened = await call({ code: PTP_OP.OpenSession, params: [1] });
  if (opened.code !== PTP_RESPONSE.OK && opened.code !== PTP_RESPONSE.SessionAlreadyOpen) ok(opened, 'open a session');
  options.onConnected?.(info);

  const camera = cameraName(info);
  const events: TetherStatus['events'] = info.operations.has(PTP_OP.NikonGetEvent) ? 'nikon' : transport.nextEvent ? 'interrupt' : 'poll';
  let saved = 0;
  const report = (fetching: TetherStatus['fetching']) => options.onStatus?.({ camera, saved, fetching, events });
  report(null);

  const done = new Set<number>();
  const listHandles = async () => new Set(readHandles(ok(await call({ code: PTP_OP.GetObjectHandles, params: [0xffffffff, 0, 0] }), 'list its photos').data));
  // Polling has nothing to compare against except what was already there.
  let known = events === 'poll' ? await listHandles() : new Set<number>();

  async function fetch(handle: number) {
    if (done.has(handle) && handle !== NIKON_SDRAM_HANDLE) return;
    done.add(handle);
    const objectInfo = parseObjectInfo(ok(await call({ code: PTP_OP.GetObjectInfo, params: [handle] }), 'describe a new photo').data);
    if (objectInfo.format === PTP_FORMAT_ASSOCIATION || !objectInfo.filename || !options.wanted(objectInfo.filename)) return;
    const name = objectInfo.filename;
    report({ name, received: 0, total: objectInfo.size });
    const object = ok(await call({ code: PTP_OP.GetObject, params: [handle] }, {
      timeoutMs: 30_000,
      onProgress: (received, total) => report({ name, received, total }),
    }), `send ${name}`);
    if (objectInfo.size !== 0xffffffff && object.data.length !== objectInfo.size) {
      throw new PtpError(`${name} arrived incomplete (${object.data.length} of ${objectInfo.size} bytes), so it was not added.`);
    }
    await sink.save(name, object.data);
    saved++;
    report(null);
  }

  async function handle(event: PtpEvent) {
    if (event.code === PTP_EVENT.ObjectAdded && event.params[0] !== undefined) await fetch(event.params[0]);
    else if (event.code === PTP_EVENT.NikonObjectAddedInSdram) await fetch(event.params[0] || NIKON_SDRAM_HANDLE);
  }

  try {
    while (!signal.aborted) {
      if (events === 'nikon') {
        const response = await call({ code: PTP_OP.NikonGetEvent });
        if (response.code === PTP_RESPONSE.OK && response.data.length) {
          for (const event of parseNikonEvents(response.data)) { if (signal.aborted) break; await handle(event); }
        }
        await sleep(pollMs);
      } else if (events === 'interrupt') {
        const event = await transport.nextEvent!(500);
        if (event) await handle(event);
      } else {
        const now = await listHandles();
        for (const handleId of now) if (!known.has(handleId) && !signal.aborted) await fetch(handleId);
        known = now;
        await sleep(Math.max(pollMs, 1000));
      }
    }
  } finally {
    if (signal.aborted) {
      await transport.transact({ code: PTP_OP.CloseSession }).catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
}

export function readHandles(data: Uint8Array): number[] {
  if (data.length < 4) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = Math.min(view.getUint32(0, true), Math.floor((data.length - 4) / 4));
  return Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, true));
}
