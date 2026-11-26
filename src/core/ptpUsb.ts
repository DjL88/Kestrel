import { CONTAINER, CONTAINER_HEADER, PTP_OP, PtpError, decodeHeader, encodeContainer, readUint32Params, uint32Params, type PtpEvent } from './ptp';

/**
 * PTP over USB (the Still Image Capture class): commands and data go out on the bulk-out pipe, data and responses come
 * back on bulk-in, and the camera reports events on an interrupt pipe. This turns any of those pipes into one
 * transaction-at-a-time `PtpTransport`, the same whether the pipe is the desktop app's native USB link, WebUSB in
 * Chrome, or Android's USB host.
 */
export interface UsbPipe {
  bulkOut(bytes: Uint8Array): Promise<void>;
  /** One bulk-in transfer of at most `maxLength` bytes; an empty array is a zero-length packet. Rejects on timeout. */
  bulkIn(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
  /** One interrupt-in packet, or null when nothing came within the time. Absent when the camera has no event pipe. */
  interruptIn?(timeoutMs: number): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export interface PtpRequest { code: number; params?: readonly number[]; dataOut?: Uint8Array }
export interface PtpResponse { code: number; params: number[]; data: Uint8Array }

/** Anything that can run one PTP transaction and wait for events: USB here, PTP/IP later. */
export interface PtpTransport {
  transact(request: PtpRequest, options?: { onProgress?: (received: number, total: number) => void; timeoutMs?: number }): Promise<PtpResponse>;
  /** The next event the camera reports by itself, or null after `timeoutMs`. Absent when it only reports by polling. */
  nextEvent?: (timeoutMs: number) => Promise<PtpEvent | null>;
  close(): Promise<void>;
}

/** Bulk-in transfers are asked for in steps this big: a multiple of every USB packet size, and quick to hand over. */
const IN_STEP = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export function usbTransport(pipe: UsbPipe): PtpTransport {
  // PTP: OpenSession goes as transaction 0, everything after counts up from 1.
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();
  let leftover = new Uint8Array(0);

  async function readSome(timeoutMs: number): Promise<Uint8Array> {
    if (leftover.length) { const chunk = leftover; leftover = new Uint8Array(0); return chunk; }
    for (let empty = 0; empty < 4; empty++) {
      const chunk = await pipe.bulkIn(IN_STEP, timeoutMs);
      if (chunk.length) return chunk;
    }
    throw new PtpError('The camera stopped answering.');
  }

  /** One whole container from bulk-in. Data containers are gathered into one buffer, reporting progress. */
  async function readContainer(timeoutMs: number, onProgress?: (received: number, total: number) => void) {
    let first = await readSome(timeoutMs);
    while (first.length < CONTAINER_HEADER) {
      const more = await readSome(timeoutMs);
      const joined = new Uint8Array(first.length + more.length); joined.set(first); joined.set(more, first.length); first = joined;
    }
    const header = decodeHeader(first);
    if (header.length === 0xffffffff) throw new PtpError('This file is over 4 GB, which InFlight cannot fetch over USB yet.');
    const payload = new Uint8Array(header.length - CONTAINER_HEADER);
    let filled = Math.min(payload.length, first.length - CONTAINER_HEADER);
    payload.set(first.subarray(CONTAINER_HEADER, CONTAINER_HEADER + filled));
    if (first.length > header.length) leftover = first.slice(header.length);
    onProgress?.(filled, payload.length);
    while (filled < payload.length) {
      const chunk = await readSome(timeoutMs);
      const take = Math.min(chunk.length, payload.length - filled);
      payload.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take < chunk.length) leftover = chunk.slice(take);
      onProgress?.(filled, payload.length);
    }
    return { ...header, payload };
  }

  async function run(request: PtpRequest, options: { onProgress?: (received: number, total: number) => void; timeoutMs?: number } = {}): Promise<PtpResponse> {
    const transactionId = request.code === PTP_OP.OpenSession ? 0 : nextId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await pipe.bulkOut(encodeContainer({ type: CONTAINER.Command, code: request.code, transactionId, payload: uint32Params(request.params ?? []) }));
    if (request.dataOut) {
      await pipe.bulkOut(encodeContainer({ type: CONTAINER.Data, code: request.code, transactionId, payload: request.dataOut }));
    }
    let data = new Uint8Array(0);
    for (;;) {
      const container = await readContainer(timeoutMs, options.onProgress);
      if (container.transactionId !== transactionId && container.type !== CONTAINER.Event) {
        throw new PtpError('The camera answered a different request. Reconnect the camera and try again.');
      }
      if (container.type === CONTAINER.Data) { data = container.payload; continue; }
      if (container.type === CONTAINER.Response) return { code: container.code, params: readUint32Params(container.payload), data };
    }
  }

  const transport: PtpTransport = {
    transact(request, options) {
      const result = queue.then(() => run(request, options));
      queue = result.catch(() => undefined);
      return result;
    },
    close: () => pipe.close(),
  };
  if (pipe.interruptIn) {
    const interruptIn = pipe.interruptIn.bind(pipe);
    transport.nextEvent = async (timeoutMs) => {
      const packet = await interruptIn(timeoutMs);
      if (!packet || packet.length < CONTAINER_HEADER) return null;
      const header = decodeHeader(packet);
      if (header.type !== CONTAINER.Event) return null;
      return { code: header.code, params: readUint32Params(packet.subarray(CONTAINER_HEADER, header.length)) };
    };
  }
  return transport;
}
