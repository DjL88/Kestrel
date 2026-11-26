/**
 * Picture Transfer Protocol (PTP, ISO 15740): the one language almost every camera speaks over USB, and (as PTP/IP)
 * over Wi-Fi. InFlight's own implementation, written once here and shared by every transport: the desktop app's USB
 * link, WebUSB in Chrome, Android's USB host and, later, PTP/IP. Pure: bytes in, values out. Nothing here talks to a
 * device, and nothing here ever asks a camera to delete, format or change anything.
 *
 * Codes follow ISO 15740 / PIMA 15740:2000 and the USB Still Image Capture Device class (bInterfaceClass 6).
 * Nikon's vendor event poll (0x90C7) is from Nikon's published PTP documents and matches libgphoto2's ptp.h.
 */

export const PTP_OP = {
  GetDeviceInfo: 0x1001,
  OpenSession: 0x1002,
  CloseSession: 0x1003,
  GetStorageIDs: 0x1004,
  GetObjectHandles: 0x1007,
  GetObjectInfo: 0x1008,
  GetObject: 0x1009,
  GetPartialObject: 0x101b,
  /** Nikon: return the events queued since the last call (cameras that report events by polling, not interrupt). */
  NikonGetEvent: 0x90c7,
} as const;

export const PTP_RESPONSE = {
  OK: 0x2001,
  GeneralError: 0x2002,
  SessionNotOpen: 0x2003,
  OperationNotSupported: 0x2005,
  DeviceBusy: 0x2019,
  SessionAlreadyOpen: 0x201e,
} as const;

export const PTP_EVENT = {
  ObjectAdded: 0x4002,
  ObjectRemoved: 0x4003,
  DeviceInfoChanged: 0x4008,
  StoreFull: 0x400a,
  CaptureComplete: 0x400d,
  /** Nikon: a shot is waiting in the camera's memory (saving to PC with no card); handle 0xFFFF0001. */
  NikonObjectAddedInSdram: 0xc101,
} as const;

/** Object format codes for folders and associations: never downloaded. */
export const PTP_FORMAT_ASSOCIATION = 0x3001;

export const CONTAINER = { Command: 1, Data: 2, Response: 3, Event: 4 } as const;
export const CONTAINER_HEADER = 12;

export class PtpError extends Error {
  constructor(message: string, readonly code?: number) { super(message); this.name = 'PtpError'; }
}

export function responseName(code: number): string {
  const entry = Object.entries(PTP_RESPONSE).find(([, value]) => value === code);
  return entry ? entry[0] : `0x${code.toString(16).padStart(4, '0')}`;
}

/** A USB-style container: what PTP over USB sends in each phase. PTP/IP wraps the same fields in its own packets. */
export interface PtpContainer { type: number; code: number; transactionId: number; payload: Uint8Array }

export function encodeContainer(container: PtpContainer): Uint8Array {
  const out = new Uint8Array(CONTAINER_HEADER + container.payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, true);
  view.setUint16(4, container.type, true);
  view.setUint16(6, container.code, true);
  view.setUint32(8, container.transactionId, true);
  out.set(container.payload, CONTAINER_HEADER);
  return out;
}

/** The header of a container; `length` is the whole container, header included. */
export function decodeHeader(bytes: Uint8Array): { length: number; type: number; code: number; transactionId: number } {
  if (bytes.length < CONTAINER_HEADER) throw new PtpError('The camera sent a reply too short to read.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(0, true);
  const type = view.getUint16(4, true);
  if (length < CONTAINER_HEADER || type < 1 || type > 5) throw new PtpError('The camera sent a reply InFlight cannot read.');
  return { length, type, code: view.getUint16(6, true), transactionId: view.getUint32(8, true) };
}

export function uint32Params(params: readonly number[]): Uint8Array {
  const out = new Uint8Array(params.length * 4);
  const view = new DataView(out.buffer);
  params.forEach((param, index) => view.setUint32(index * 4, param >>> 0, true));
  return out;
}

export function readUint32Params(payload: Uint8Array): number[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const out: number[] = [];
  for (let offset = 0; offset + 4 <= payload.length && out.length < 5; offset += 4) out.push(view.getUint32(offset, true));
  return out;
}

/** Reads PTP datasets: little-endian integers, counted arrays and UCS-2 strings with a length byte. */
export class PtpReader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  private need(count: number) { if (this.offset + count > this.bytes.length) throw new PtpError('The camera sent a description that stops short.'); }
  u8() { this.need(1); return this.view.getUint8(this.offset++); }
  u16() { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { this.need(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u16Array() { const count = this.u32(); this.need(count * 2); return Array.from({ length: count }, () => this.u16()); }
  u32Array() { const count = this.u32(); this.need(count * 4); return Array.from({ length: count }, () => this.u32()); }
  string() {
    const chars = this.u8();
    if (chars === 0) return '';
    this.need(chars * 2);
    const units: number[] = [];
    for (let index = 0; index < chars; index++) units.push(this.u16());
    while (units.length && units.at(-1) === 0) units.pop();
    return String.fromCharCode(...units);
  }
  get remaining() { return this.bytes.length - this.offset; }
}

export function encodePtpString(text: string): Uint8Array {
  if (!text) return new Uint8Array([0]);
  const chars = Math.min(text.length, 254);
  const out = new Uint8Array(1 + (chars + 1) * 2);
  out[0] = chars + 1;
  const view = new DataView(out.buffer);
  for (let index = 0; index < chars; index++) view.setUint16(1 + index * 2, text.charCodeAt(index), true);
  return out;
}

export interface PtpDeviceInfo {
  vendorExtensionId: number;
  vendorExtension: string;
  operations: ReadonlySet<number>;
  events: ReadonlySet<number>;
  manufacturer: string;
  model: string;
  version: string;
  serial: string;
}

export function parseDeviceInfo(bytes: Uint8Array): PtpDeviceInfo {
  const read = new PtpReader(bytes);
  read.u16(); // standard version
  const vendorExtensionId = read.u32();
  read.u16(); // vendor extension version
  const vendorExtension = read.string();
  read.u16(); // functional mode
  const operations = new Set(read.u16Array());
  const events = new Set(read.u16Array());
  read.u16Array(); // device properties
  read.u16Array(); // capture formats
  read.u16Array(); // image formats
  return { vendorExtensionId, vendorExtension, operations, events, manufacturer: read.string(), model: read.string(), version: read.string(), serial: read.string() };
}

export interface PtpObjectInfo {
  storageId: number;
  format: number;
  /** Bytes; 0xFFFFFFFF means "over 4 GB" in PTP, so the download length is taken from the data phase instead. */
  size: number;
  parent: number;
  filename: string;
  captured: string;
}

export function parseObjectInfo(bytes: Uint8Array): PtpObjectInfo {
  const read = new PtpReader(bytes);
  const storageId = read.u32();
  const format = read.u16();
  read.u16(); // protection
  const size = read.u32();
  read.u16(); read.u32(); read.u32(); read.u32(); // thumbnail format, size, width, height
  read.u32(); read.u32(); read.u32(); // image width, height, bit depth
  const parent = read.u32();
  read.u16(); read.u32(); read.u32(); // association type, description, sequence number
  const filename = read.string();
  const captured = read.remaining > 0 ? read.string() : '';
  return { storageId, format, size, parent, filename, captured };
}

export interface PtpEvent { code: number; params: number[] }

/** Nikon's GetEvent dataset: a count, then (code, one parameter) pairs. */
export function parseNikonEvents(bytes: Uint8Array): PtpEvent[] {
  const read = new PtpReader(bytes);
  const count = read.u16();
  const events: PtpEvent[] = [];
  for (let index = 0; index < count && read.remaining >= 6; index++) events.push({ code: read.u16(), params: [read.u32()] });
  return events;
}

/** USB-IF vendor ids of the camera makers InFlight names; anything else is still tried if it is a still-image device. */
export const CAMERA_VENDORS: Readonly<Record<number, string>> = {
  0x04b0: 'Nikon',
  0x04a9: 'Canon',
  0x054c: 'Sony',
  0x04cb: 'Fujifilm',
  0x04da: 'Panasonic',
  0x07b4: 'OM System',
  0x25fb: 'Pentax',
  0x0a17: 'Pentax',
  0x1a98: 'Leica',
  0x2ca3: 'DJI',
};
