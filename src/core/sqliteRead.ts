/**
 * A small, read-only SQLite file reader: enough to walk the rows of ordinary (rowid) tables, as Lightroom Classic
 * catalogues use. It reads pages on demand through `read`, so a multi-gigabyte catalogue is never loaded whole, and it
 * cannot write: there is no write path at all. Pure TypeScript, no dependency, works the same in the browser, desktop
 * webview and Node.
 *
 * Not supported (refused with a plain reason, never guessed): WITHOUT ROWID tables, UTF-16 databases, and data that
 * still sits in a write-ahead log (the app holding the database has not checkpointed it; closing that app does).
 */

export type SqlValue = null | number | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;

export type SqliteFailure = 'not-sqlite' | 'unsupported' | 'corrupt' | 'too-large';
export class SqliteReadError extends Error {
  constructor(readonly reason: SqliteFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'SqliteReadError';
  }
}

interface TableInfo { name: string; rootPage: number; columns: string[]; rowidColumn: number; withoutRowid: boolean }

const MAGIC = 'SQLite format 3\u0000';
const MAX_DEPTH = 40;
const textDecoder = new TextDecoder('utf-8');

export class SqliteFile {
  private readonly cache = new Map<number, Uint8Array>();
  private tablesCache: Map<string, TableInfo> | null = null;
  private pagesRead = 0;

  private constructor(
    private readonly read: ReadBytes,
    readonly pageSize: number,
    private readonly usable: number,
    readonly pageCount: number,
    /** True when the header says the database uses a write-ahead log, so recent changes may not be in this file yet. */
    readonly walMode: boolean,
    private readonly maxPages: number,
  ) {}

  /** Open a database through a byte reader. `fileSize` bounds every page read. */
  static async open(read: ReadBytes, fileSize: number, options: { maxPages?: number } = {}): Promise<SqliteFile> {
    if (fileSize < 512) throw new SqliteReadError('not-sqlite');
    const header = await read(0, 100);
    if (header.length < 100 || textDecoder.decode(header.subarray(0, 16)) !== MAGIC) throw new SqliteReadError('not-sqlite');
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const rawSize = view.getUint16(16);
    const pageSize = rawSize === 1 ? 65536 : rawSize;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) throw new SqliteReadError('corrupt', 'page size');
    const reserved = header[20];
    const usable = pageSize - reserved;
    if (usable < 480) throw new SqliteReadError('corrupt', 'usable size');
    const encoding = view.getUint32(56);
    if (encoding !== 0 && encoding !== 1) throw new SqliteReadError('unsupported', 'text encoding is not UTF-8');
    const pageCount = Math.floor(fileSize / pageSize);
    if (pageCount < 1) throw new SqliteReadError('corrupt', 'no pages');
    const walMode = header[18] === 2 || header[19] === 2;
    return new SqliteFile(read, pageSize, usable, pageCount, walMode, options.maxPages ?? 4_000_000);
  }

  private async page(number: number): Promise<Uint8Array> {
    if (!Number.isInteger(number) || number < 1 || number > this.pageCount) throw new SqliteReadError('corrupt', `page ${number}`);
    const hit = this.cache.get(number);
    if (hit) return hit;
    if (++this.pagesRead > this.maxPages) throw new SqliteReadError('too-large');
    const bytes = await this.read((number - 1) * this.pageSize, this.pageSize);
    if (bytes.length !== this.pageSize) throw new SqliteReadError('corrupt', `short page ${number}`);
    if (this.cache.size > 2048) this.cache.clear(); // bounded memory: interior pages are re-read if needed
    this.cache.set(number, bytes);
    return bytes;
  }

  /** Every table with its column names, read from the schema. */
  async tables(): Promise<Map<string, TableInfo>> {
    if (this.tablesCache) return this.tablesCache;
    const found = new Map<string, TableInfo>();
    for await (const { values } of this.walk(1)) {
      const [type, name, , rootPage, sql] = values;
      if (type !== 'table' || typeof name !== 'string' || typeof sql !== 'string' || typeof rootPage !== 'number') continue;
      const parsed = parseCreateTable(sql);
      found.set(name, { name, rootPage, ...parsed });
    }
    this.tablesCache = found;
    return found;
  }

  /** Column names of a table, or null when it does not exist. */
  async columns(table: string): Promise<string[] | null> {
    return (await this.tables()).get(table)?.columns ?? null;
  }

  /** Every row of a table as { column: value }. An INTEGER PRIMARY KEY column holds the rowid, as in SQLite itself. */
  async *rows(table: string): AsyncGenerator<SqlRow> {
    const info = (await this.tables()).get(table);
    if (!info) throw new SqliteReadError('unsupported', `no table ${table}`);
    if (info.withoutRowid) throw new SqliteReadError('unsupported', `${table} is WITHOUT ROWID`);
    for await (const { rowid, values } of this.walk(info.rootPage)) {
      const row: SqlRow = {};
      info.columns.forEach((column, index) => {
        // Columns added later by ALTER TABLE are absent from older records: SQLite reads them as NULL.
        row[column] = index === info.rowidColumn ? rowid : values[index] ?? null;
      });
      yield row;
    }
  }

  /** Walk a table b-tree in rowid order. */
  private async *walk(root: number, depth = 0): AsyncGenerator<{ rowid: number; values: SqlValue[] }> {
    if (depth > MAX_DEPTH) throw new SqliteReadError('corrupt', 'b-tree too deep');
    const bytes = await this.page(root);
    const base = root === 1 ? 100 : 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kind = bytes[base];
    const cells = view.getUint16(base + 3);
    if (kind === 0x0d) {
      for (let i = 0; i < cells; i++) {
        const at = view.getUint16(base + 8 + i * 2);
        yield await this.leafCell(bytes, at);
      }
    } else if (kind === 0x05) {
      for (let i = 0; i < cells; i++) {
        const at = view.getUint16(base + 12 + i * 2);
        if (at + 4 > bytes.length) throw new SqliteReadError('corrupt', 'cell pointer');
        yield* this.walk(view.getUint32(at), depth + 1);
      }
      yield* this.walk(view.getUint32(base + 8), depth + 1);
    } else {
      throw new SqliteReadError('corrupt', `page ${root} is not a table page`);
    }
  }

  private async leafCell(bytes: Uint8Array, at: number): Promise<{ rowid: number; values: SqlValue[] }> {
    if (at >= bytes.length) throw new SqliteReadError('corrupt', 'cell offset');
    const [payloadSize, afterSize] = varint(bytes, at);
    const [rowid, afterRowid] = varint(bytes, afterSize);
    const u = this.usable;
    const x = u - 35;
    let payload: Uint8Array;
    if (payloadSize <= x) {
      if (afterRowid + payloadSize > bytes.length) throw new SqliteReadError('corrupt', 'cell size');
      payload = bytes.subarray(afterRowid, afterRowid + payloadSize);
    } else {
      const m = Math.floor(((u - 12) * 32) / 255) - 23;
      const k = m + ((payloadSize - m) % (u - 4));
      const local = k <= x ? k : m;
      if (afterRowid + local + 4 > bytes.length) throw new SqliteReadError('corrupt', 'overflow cell');
      payload = new Uint8Array(payloadSize);
      payload.set(bytes.subarray(afterRowid, afterRowid + local), 0);
      let filled = local;
      let next = new DataView(bytes.buffer, bytes.byteOffset).getUint32(afterRowid + local);
      let hops = 0;
      while (filled < payloadSize) {
        if (next === 0 || ++hops > this.pageCount) throw new SqliteReadError('corrupt', 'overflow chain');
        const overflow = await this.page(next);
        const take = Math.min(u - 4, payloadSize - filled);
        payload.set(overflow.subarray(4, 4 + take), filled);
        filled += take;
        next = new DataView(overflow.buffer, overflow.byteOffset).getUint32(0);
      }
    }
    return { rowid, values: decodeRecord(payload) };
  }
}

/** Open a browser or desktop File for reading, page by page. */
export function openSqliteFile(file: Blob, options?: { maxPages?: number }): Promise<SqliteFile> {
  return SqliteFile.open(async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()), file.size, options);
}

/** Open bytes already in memory (tests, small files). */
export function openSqliteBytes(bytes: Uint8Array): Promise<SqliteFile> {
  return SqliteFile.open(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length);
}

function varint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 9; i++) {
    if (at + i >= bytes.length) throw new SqliteReadError('corrupt', 'varint');
    const byte = bytes[at + i];
    if (i === 8) return [value * 256 + byte, at + 9];
    value = value * 128 + (byte & 0x7f);
    if (byte < 0x80) return [value, at + i + 1];
  }
  return [value, at + 9];
}

function decodeRecord(payload: Uint8Array): SqlValue[] {
  const [headerSize, first] = varint(payload, 0);
  if (headerSize > payload.length) throw new SqliteReadError('corrupt', 'record header');
  const types: number[] = [];
  for (let at = first; at < headerSize;) {
    const [type, next] = varint(payload, at);
    types.push(type);
    at = next;
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values: SqlValue[] = [];
  let at = headerSize;
  for (const type of types) {
    const size = serialSize(type);
    if (at + size > payload.length) throw new SqliteReadError('corrupt', 'record body');
    values.push(serialValue(type, payload, view, at, size));
    at += size;
  }
  return values;
}

function serialSize(type: number): number {
  if (type <= 4) return [0, 1, 2, 3, 4][type];
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type === 8 || type === 9) return 0;
  if (type === 10 || type === 11) throw new SqliteReadError('corrupt', 'reserved serial type');
  return Math.floor((type - (type % 2 === 0 ? 12 : 13)) / 2);
}

function serialValue(type: number, bytes: Uint8Array, view: DataView, at: number, size: number): SqlValue {
  switch (type) {
    case 0: return null;
    case 1: return view.getInt8(at);
    case 2: return view.getInt16(at);
    case 3: return (view.getInt8(at) << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
    case 4: return view.getInt32(at);
    case 5: return view.getInt16(at) * 2 ** 32 + view.getUint32(at + 2);
    case 6: return Number(view.getBigInt64(at));
    case 7: return view.getFloat64(at);
    case 8: return 0;
    case 9: return 1;
    default:
      return type % 2 === 0 ? bytes.slice(at, at + size) : textDecoder.decode(bytes.subarray(at, at + size));
  }
}

/** Column names from a CREATE TABLE statement, in declared order, and which one (if any) is the rowid alias. */
export function parseCreateTable(sql: string): { columns: string[]; rowidColumn: number; withoutRowid: boolean } {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) throw new SqliteReadError('unsupported', 'table definition');
  const body = sql.slice(open + 1, close);
  const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(sql.slice(close));
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
    } else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  const columns: string[] = [];
  const declared: string[] = [];
  let rowidColumn = -1;
  let tablePrimaryKey: string | null = null;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const constraint = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.exec(part);
    if (constraint) {
      const key = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(\s*([^,)]+?)\s*\)/i.exec(part);
      if (key) tablePrimaryKey = unquote(key[1]);
      continue;
    }
    const match = /^("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|'[^']*'|\S+)\s*(.*)$/s.exec(part);
    if (!match) continue;
    const name = unquote(match[1]);
    const rest = match[2];
    if (/^INTEGER\b/i.test(rest) && /\bPRIMARY\s+KEY\b/i.test(rest) && !/\bPRIMARY\s+KEY\s+DESC\b/i.test(rest)) rowidColumn = columns.length;
    columns.push(name);
    declared.push(rest);
  }
  if (rowidColumn < 0 && tablePrimaryKey) {
    const index = columns.indexOf(tablePrimaryKey);
    if (index >= 0 && /^INTEGER\b/i.test(declared[index])) rowidColumn = index;
  }
  return { columns, rowidColumn, withoutRowid };
}

function unquote(name: string): string {
  if (/^".*"$/s.test(name)) return name.slice(1, -1).replace(/""/g, '"');
  if (/^[`'[].*[`'\]]$/s.test(name)) return name.slice(1, -1);
  return name;
}
