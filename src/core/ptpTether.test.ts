import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTAINER, PTP_EVENT, PTP_OP, PTP_RESPONSE, decodeHeader, encodeContainer, encodePtpString, parseDeviceInfo, parseObjectInfo, readUint32Params, uint32Params } from './ptp';
import { cameraName, runTether } from './ptpTether';
import { usbTransport, type UsbPipe } from './ptpUsb';

/** A pretend camera on the far end of a USB pipe: answers in 512-byte packets with zero-length packets, as real ones do. */
interface FakeObject { name: string; bytes: Uint8Array; format?: number }
function fakeCamera(options: { nikon?: boolean; interrupt?: boolean; model?: string; busyOnce?: boolean; objects?: Map<number, FakeObject> }) {
  const objects = options.objects ?? new Map<number, FakeObject>();
  const outgoing: Uint8Array[] = [];
  const nikonEvents: Array<[number, number]> = [];
  const interruptQueue: Uint8Array[] = [];
  const seen: number[] = [];
  let busy = options.busyOnce ?? false;
  let sessionOpen = false;

  function u16Array(values: number[]) { const out = new Uint8Array(4 + values.length * 2); const view = new DataView(out.buffer); view.setUint32(0, values.length, true); values.forEach((v, i) => view.setUint16(4 + i * 2, v, true)); return out; }
  function join(...parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  function u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
  function u32(v: number) { return uint32Params([v]); }
  function deviceInfo() {
    const ops = [PTP_OP.GetDeviceInfo, PTP_OP.OpenSession, PTP_OP.CloseSession, PTP_OP.GetObjectHandles, PTP_OP.GetObjectInfo, PTP_OP.GetObject, ...(options.nikon ? [PTP_OP.NikonGetEvent] : [])];
    return join(u16(100), u32(options.nikon ? 0x0a : 6), u16(100), encodePtpString('microsoft.com: 1.0'), u16(0), u16Array(ops), u16Array([PTP_EVENT.ObjectAdded]), u16Array([]), u16Array([]), u16Array([0x3801]),
      encodePtpString(options.nikon ? 'Nikon Corporation' : 'Example Cameras'), encodePtpString(options.model ?? 'Z 8'), encodePtpString('1.00'), encodePtpString('0001'));
  }
  function objectInfo(object: FakeObject) {
    return join(u32(0x00010001), u16(object.format ?? 0x3000), u16(0), u32(object.bytes.length), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u16(0), u32(0), u32(0), encodePtpString(object.name), encodePtpString('20261126T120000'));
  }
  function send(container: Uint8Array) {
    for (let offset = 0; offset < container.length; offset += 512) outgoing.push(container.slice(offset, offset + 512));
    if (container.length % 512 === 0) outgoing.push(new Uint8Array(0));
  }
  function respond(code: number, transactionId: number, opCode: number, data?: Uint8Array, params: number[] = []) {
    if (data) send(encodeContainer({ type: CONTAINER.Data, code: opCode, transactionId, payload: data }));
    send(encodeContainer({ type: CONTAINER.Response, code, transactionId, payload: uint32Params(params) }));
  }
  const pipe: UsbPipe = {
    async bulkOut(bytes) {
      const header = decodeHeader(bytes);
      if (header.type !== CONTAINER.Command) return;
      const params = readUint32Params(bytes.subarray(12));
      seen.push(header.code);
      const { code, transactionId: id } = header;
      if (code === PTP_OP.GetDeviceInfo) return respond(PTP_RESPONSE.OK, id, code, deviceInfo());
      if (code === PTP_OP.OpenSession) { assert.equal(id, 0, 'OpenSession goes as transaction 0'); sessionOpen = true; return respond(PTP_RESPONSE.OK, id, code); }
      if (!sessionOpen) return respond(PTP_RESPONSE.SessionNotOpen, id, code);
      if (code === PTP_OP.CloseSession) { sessionOpen = false; return respond(PTP_RESPONSE.OK, id, code); }
      if (code === PTP_OP.GetObjectHandles) { const handles = [...objects.keys()]; return respond(PTP_RESPONSE.OK, id, code, join(u32(handles.length), ...handles.map(u32))); }
      if (code === PTP_OP.NikonGetEvent) {
        const events = nikonEvents.splice(0);
        return respond(PTP_RESPONSE.OK, id, code, join(u16(events.length), ...events.map(([c, p]) => join(u16(c), u32(p)))));
      }
      const object = objects.get(params[0]!);
      if (!object) return respond(0x2009, id, code); // invalid object handle
      if (code === PTP_OP.GetObjectInfo) return respond(PTP_RESPONSE.OK, id, code, objectInfo(object));
      if (code === PTP_OP.GetObject) {
        if (busy) { busy = false; return respond(PTP_RESPONSE.DeviceBusy, id, code); }
        return respond(PTP_RESPONSE.OK, id, code, object.bytes);
      }
      respond(PTP_RESPONSE.OperationNotSupported, id, code);
    },
    async bulkIn(maxLength) {
      const next = outgoing.shift();
      if (!next) throw new Error('timed out');
      // A real pipe returns several packets in one transfer up to the first short packet.
      let chunk = next;
      while (chunk.length === 512 * Math.ceil(chunk.length / 512) && chunk.length > 0 && chunk.length < maxLength && outgoing.length && outgoing[0]!.length > 0) {
        const more = outgoing.shift()!; const joined = new Uint8Array(chunk.length + more.length); joined.set(chunk); joined.set(more, chunk.length); chunk = joined;
        if (more.length < 512) break;
      }
      return chunk;
    },
    async close() {},
  };
  if (options.interrupt) pipe.interruptIn = async () => interruptQueue.shift() ?? (await new Promise((r) => setTimeout(r, 2)), null);
  return {
    pipe, seen, objects,
    shoot(handle: number, object: FakeObject) {
      objects.set(handle, object);
      if (options.nikon) nikonEvents.push([PTP_EVENT.ObjectAdded, handle]);
      else if (options.interrupt) interruptQueue.push(encodeContainer({ type: CONTAINER.Event, code: PTP_EVENT.ObjectAdded, transactionId: 0, payload: uint32Params([handle]) }));
    },
  };
}

const photo = (size: number, seed = 1) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff);
const isPhoto = (name: string) => /\.(nef|cr3|arw|jpg|raf)$/i.test(name);

async function tetherUntil(camera: ReturnType<typeof fakeCamera>, saved: Array<{ name: string; bytes: Uint8Array }>, want: number, during: () => void) {
  const controller = new AbortController();
  let shot = false;
  const running = runTether(usbTransport(camera.pipe), { async save(name, bytes) { saved.push({ name, bytes }); if (saved.length >= want) controller.abort(); } }, {
    signal: controller.signal, wanted: isPhoto, pollMs: 1, sleep: async () => { if (!shot) { shot = true; during(); } await new Promise((r) => setTimeout(r, 1)); },
    onStatus: () => { if (!shot && camera.pipe.interruptIn) { shot = true; during(); } },
  });
  const timer = setTimeout(() => controller.abort(), 3000);
  await running;
  clearTimeout(timer);
}

test('PTP strings and containers round-trip', () => {
  const header = decodeHeader(encodeContainer({ type: CONTAINER.Command, code: PTP_OP.GetObject, transactionId: 7, payload: uint32Params([42]) }));
  assert.deepEqual(header, { length: 16, type: 1, code: 0x1009, transactionId: 7 });
  assert.throws(() => decodeHeader(new Uint8Array(4)));
});

test('a Nikon (event polling) tether fetches only frames shot while tethered, whole and byte-exact', async () => {
  const old = photo(2000);
  const camera = fakeCamera({ nikon: true, objects: new Map([[1, { name: 'DSC_0001.NEF', bytes: old }]]) });
  const saved: Array<{ name: string; bytes: Uint8Array }> = [];
  // 1536 bytes: an exact multiple of the packet size, so the camera ends the data with a zero-length packet.
  await tetherUntil(camera, saved, 2, () => { camera.shoot(2, { name: 'DSC_0002.NEF', bytes: photo(1536, 2) }); camera.shoot(3, { name: 'DSC_0003.NEF', bytes: photo(5_000_123, 3) }); });
  assert.deepEqual(saved.map((s) => s.name), ['DSC_0002.NEF', 'DSC_0003.NEF']);
  assert.deepEqual(saved[0]!.bytes, photo(1536, 2));
  assert.deepEqual(saved[1]!.bytes, photo(5_000_123, 3));
  assert.ok(camera.seen.includes(PTP_OP.CloseSession), 'session closed on stop');
  assert.ok(!camera.seen.some((code) => code === 0x100b || code === 0x100f), 'never deletes or formats');
});

test('a camera with an event pipe is followed by its ObjectAdded events; busy is waited out; videos stay on the card', async () => {
  const camera = fakeCamera({ interrupt: true, busyOnce: true, model: 'ILCE-7M4' });
  const saved: Array<{ name: string; bytes: Uint8Array }> = [];
  await tetherUntil(camera, saved, 1, () => { camera.shoot(9, { name: 'C0001.MP4', bytes: photo(100) }); camera.shoot(10, { name: 'DSC00010.ARW', bytes: photo(3000, 4) }); });
  assert.deepEqual(saved.map((s) => s.name), ['DSC00010.ARW']);
  assert.ok(!camera.seen.includes(PTP_OP.NikonGetEvent));
});

test('a camera with neither is polled by listing, against what was already on the card', async () => {
  const camera = fakeCamera({ objects: new Map([[1, { name: 'IMG_0001.CR3', bytes: photo(10) }]]) });
  const saved: Array<{ name: string; bytes: Uint8Array }> = [];
  await tetherUntil(camera, saved, 1, () => { camera.objects.set(2, { name: 'IMG_0002.CR3', bytes: photo(700, 5) }); });
  assert.deepEqual(saved.map((s) => s.name), ['IMG_0002.CR3']);
});

test('device and object descriptions parse; camera names read naturally', () => {
  const camera = fakeCamera({ nikon: true });
  let info: ReturnType<typeof parseDeviceInfo> | undefined;
  return (async () => {
    const transport = usbTransport(camera.pipe);
    info = parseDeviceInfo((await transport.transact({ code: PTP_OP.GetDeviceInfo })).data);
    assert.equal(info.model, 'Z 8');
    assert.ok(info.operations.has(PTP_OP.NikonGetEvent));
    assert.equal(cameraName(info), 'Nikon Z 8');
    assert.equal(cameraName({ manufacturer: 'Canon Inc.', model: 'Canon EOS R5' }), 'Canon EOS R5');
    assert.equal(cameraName({ manufacturer: '', model: '' }), 'Camera');
    await transport.transact({ code: PTP_OP.OpenSession, params: [1] });
    camera.objects.set(5, { name: 'DSC_0005.NEF', bytes: photo(10) });
    const objectInfo = parseObjectInfo((await transport.transact({ code: PTP_OP.GetObjectInfo, params: [5] })).data);
    assert.equal(objectInfo.filename, 'DSC_0005.NEF');
    assert.equal(objectInfo.size, 10);
  })();
});
