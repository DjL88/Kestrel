/**
 * The few WASI functions Kestrel's RAW WebAssembly (crates/kestrel-raw-wasm, built for wasm32-wasip1) imports: random
 * bytes, the clock, an empty environment, and stderr. Nothing touches files or the network. A decoder panic writes its
 * message to stderr before stopping, so the message is kept and can be shown in plain words.
 */

export interface WasiShim {
  imports: { wasi_snapshot_preview1: Record<string, (...args: never[]) => number> };
  /** Hand the shim the module's memory once it is instantiated. */
  attach(memory: WebAssembly.Memory): void;
  /** What the module last wrote to stderr (a panic message), or ''. */
  stderr(): string;
}

const SUCCESS = 0;
const BAD_FILE = 8; // WASI errno EBADF

export class WasiExit extends Error {
  constructor(readonly code: number) { super(`The RAW decoder stopped (exit ${code}).`); }
}

export function createWasiShim(): WasiShim {
  let memory: WebAssembly.Memory | null = null;
  let errorText = '';
  const view = () => {
    if (!memory) throw new Error('WASI memory not attached');
    return new DataView(memory.buffer);
  };
  const bytes = (pointer: number, length: number) => new Uint8Array(memory!.buffer, pointer, length);
  const functions = {
    random_get(pointer: number, length: number) {
      // getRandomValues fills at most 65,536 bytes per call.
      for (let offset = 0; offset < length; offset += 65536) {
        crypto.getRandomValues(bytes(pointer + offset, Math.min(65536, length - offset)));
      }
      return SUCCESS;
    },
    environ_sizes_get(countPointer: number, sizePointer: number) {
      view().setUint32(countPointer, 0, true);
      view().setUint32(sizePointer, 0, true);
      return SUCCESS;
    },
    environ_get() {
      return SUCCESS;
    },
    clock_time_get(clock: number, _precision: bigint, timePointer: number) {
      // 0 is wall-clock time; everything else is treated as the monotonic clock. Nanoseconds.
      const nanoseconds = clock === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.round(performance.now() * 1_000_000));
      view().setBigUint64(timePointer, nanoseconds, true);
      return SUCCESS;
    },
    fd_write(fd: number, iovs: number, iovsLength: number, writtenPointer: number) {
      let written = 0;
      for (let i = 0; i < iovsLength; i += 1) {
        const pointer = view().getUint32(iovs + i * 8, true);
        const length = view().getUint32(iovs + i * 8 + 4, true);
        if (fd === 2) errorText = (errorText + new TextDecoder().decode(bytes(pointer, length))).slice(-2000);
        written += length;
      }
      view().setUint32(writtenPointer, written, true);
      return fd === 1 || fd === 2 ? SUCCESS : BAD_FILE;
    },
    proc_exit(code: number): number {
      throw new WasiExit(code);
    },
    sched_yield() {
      return SUCCESS;
    },
  };
  return {
    imports: { wasi_snapshot_preview1: functions as unknown as Record<string, (...args: never[]) => number> },
    attach(attached) { memory = attached; },
    stderr: () => errorText,
  };
}

/** The C interface of crates/kestrel-raw-wasm. */
interface RawExports {
  memory: WebAssembly.Memory;
  kr_alloc(length: number): number;
  kr_free(pointer: number, length: number): void;
  kr_develop(pointer: number, length: number): number;
  kr_sensor_mode(pointer: number, length: number, fileLength: number): number;
  kr_result_pointer(): number;
  kr_result_len(): number;
}

export type WasmSensorMode = 'nikon-he' | 'nikon-he-star' | 'other' | 'need-more';

/** One instance of Kestrel's RAW WebAssembly. After any failure that stopped the module, make a new one. */
export interface RawWasm {
  develop(file: Uint8Array): Uint8Array;
  sensorMode(prefix: Uint8Array, fileLength: number): WasmSensorMode;
  /** The module's memory now. WebAssembly memory only ever grows, so this is the high-water mark so far. */
  memoryBytes(): number;
}

/** Instantiate the RAW decoder from its compiled module. Works in a Web Worker and in Node (for tests). */
export async function instantiateRawWasm(module: WebAssembly.Module): Promise<RawWasm> {
  const shim = createWasiShim();
  const instance = await WebAssembly.instantiate(module, shim.imports as unknown as WebAssembly.Imports);
  const raw = instance.exports as unknown as RawExports;
  shim.attach(raw.memory);
  const withInput = <T>(input: Uint8Array, use: (pointer: number) => T): T => {
    const pointer = raw.kr_alloc(input.length);
    try {
      new Uint8Array(raw.memory.buffer, pointer, input.length).set(input);
      return use(pointer);
    } finally {
      raw.kr_free(pointer, input.length);
    }
  };
  const result = () => new Uint8Array(raw.memory.buffer, raw.kr_result_pointer(), raw.kr_result_len()).slice();
  return {
    develop(file) {
      let status: number;
      try {
        status = withInput(file, (pointer) => raw.kr_develop(pointer, file.length));
      } catch (error) {
        // A trap ("unreachable") after a panic or a failed allocation: say which, in plain words.
        const stderr = shim.stderr();
        if (/memory allocation of \d+ bytes failed/.test(stderr) || error instanceof RangeError) {
          throw new Error('This device ran out of room to develop this RAW file. Kestrel keeps using the preview stored in the file.', { cause: error });
        }
        const said = stderr.split('\n').find((line) => line.includes('panicked'))?.replace(/^.*panicked at [^:]*:\d+:\d+:\s*/, '');
        throw new Error(said ? `This RAW file could not be read: ${said}` : 'This RAW file could not be read.', { cause: error });
      }
      const output = result();
      if (status !== 0) throw new Error(new TextDecoder().decode(output) || 'This RAW file could not be read.');
      return output;
    },
    memoryBytes: () => raw.memory.buffer.byteLength,
    sensorMode(prefix, fileLength) {
      const code = withInput(prefix, (pointer) => raw.kr_sensor_mode(pointer, prefix.length, Math.max(fileLength, prefix.length)));
      return code === 1 ? 'nikon-he' : code === 2 ? 'nikon-he-star' : code === 3 ? 'need-more' : 'other';
    },
  };
}
