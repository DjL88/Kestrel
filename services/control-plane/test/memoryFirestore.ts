/**
 * An in-memory stand-in for the parts of Google Cloud Firestore that FirestoreStore uses. Tests run every control-plane
 * scenario against it when no Firestore emulator is available (set FIRESTORE_EMULATOR_HOST to use the real emulator).
 *
 * It copies the Firestore behaviours the store relies on, and fails loudly where real Firestore would:
 * - documents are copied in and out (no shared references); `undefined` values are refused;
 * - create() on an existing document fails with code 6 (ALREADY_EXISTS), update() on a missing one with code 5;
 * - transactions: every read must come before any write; writes are buffered and applied all at once on success,
 *   or not at all if the body throws; a transaction does not see its own writes; concurrent transactions are
 *   serialised (the server client takes locks), and plain writes wait for a running transaction;
 * - queries: equality filters, or a single orderBy without filters (anything else needs a composite index in real
 *   Firestore, so it is refused here); orderBy leaves out documents without that field.
 */
import type { FirestoreLike, FsCollection, FsData, FsDocRef, FsDocSnapshot, FsQuery, FsQuerySnapshot, FsTransaction } from '../src/firestoreStore.ts';

class FirestoreError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

function checkValue(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) checkValue(v, `${path}.${k}`);
}
const copyIn = (data: FsData) => { for (const [k, v] of Object.entries(data)) checkValue(v, k); return structuredClone(data); };

const snapshot = (id: string, data: FsData | undefined): FsDocSnapshot => ({ exists: data !== undefined, id, data: () => (data === undefined ? undefined : structuredClone(data)) });

type Write = { kind: 'set' | 'create' | 'update' | 'delete'; collection: string; id: string; data: FsData };

export class MemoryFirestore implements FirestoreLike {
  private readonly collections = new Map<string, Map<string, FsData>>();
  private lock: Promise<void> = Promise.resolve();
  terminated = false;

  private table(name: string) {
    let t = this.collections.get(name);
    if (!t) { t = new Map(); this.collections.set(name, t); }
    return t;
  }

  /** Runs `body` once no transaction or plain write is in progress. */
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const run = this.lock.then(body);
    this.lock = run.then(() => undefined, () => undefined);
    return run;
  }

  private apply(writes: Write[]): void {
    // Validate everything first so a failing write leaves nothing half-applied.
    const pending = new Map<string, FsData | undefined>();
    const key = (w: Write) => `${w.collection}\u0000${w.id}`;
    const current = (w: Write) => (pending.has(key(w)) ? pending.get(key(w)) : this.table(w.collection).get(w.id));
    for (const w of writes) {
      const existing = current(w);
      if (w.kind === 'create' && existing) throw new FirestoreError(6, `ALREADY_EXISTS: Document already exists: ${w.collection}/${w.id}`);
      if (w.kind === 'update' && !existing) throw new FirestoreError(5, `NOT_FOUND: No document to update: ${w.collection}/${w.id}`);
      pending.set(key(w), w.kind === 'delete' ? undefined : w.kind === 'update' ? { ...existing, ...copyIn(w.data) } : copyIn(w.data));
    }
    for (const w of writes) {
      const value = pending.get(key(w));
      if (value === undefined) this.table(w.collection).delete(w.id); else this.table(w.collection).set(w.id, value);
    }
  }

  /** @internal Used by queries made from this database. */
  runQuery(q: QueryState): FsQuerySnapshot {
    const ordered = q.orderBy;
    if (ordered && q.filters.length > 0) throw new FirestoreError(9, 'FAILED_PRECONDITION: The query requires a composite index.');
    let docs = [...this.table(q.collection).entries()]
      .filter(([, d]) => q.filters.every((f) => JSON.stringify(d[f.field]) === JSON.stringify(f.value)));
    if (ordered) {
      docs = docs.filter(([, d]) => d[ordered.field] !== undefined)
        .sort(([, a], [, b]) => { const x = a[ordered.field] as string | number, y = b[ordered.field] as string | number; return (x < y ? -1 : x > y ? 1 : 0) * (ordered.direction === 'desc' ? -1 : 1); });
    }
    if (q.limit !== undefined) docs = docs.slice(0, q.limit);
    const snaps = docs.map(([id, d]) => snapshot(id, d));
    return { docs: snaps, size: snaps.length, empty: snaps.length === 0 };
  }

  collection(name: string): FsCollection {
    const db = this;
    const ref = (id: string): MemoryDocRef => {
      if (!id || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) throw new Error(`Invalid document id: ${id}`);
      return {
        id, collection: name,
        get: async () => snapshot(id, db.table(name).get(id)),
        set: (data) => db.exclusive(async () => db.apply([{ kind: 'set', collection: name, id, data }])),
        create: (data) => db.exclusive(async () => db.apply([{ kind: 'create', collection: name, id, data }])),
      };
    };
    return Object.assign(makeQuery(this, { collection: name, filters: [] }), { doc: ref });
  }

  runTransaction<T>(body: (tx: FsTransaction) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const writes: Write[] = [];
      const tx: FsTransaction = {
        get: (async (target: MemoryDocRef | MemoryQuery) => {
          if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return 'state' in target ? this.runQuery(target.state) : snapshot(target.id, this.table(target.collection).get(target.id));
        }) as FsTransaction['get'],
        set: (ref, data) => { writes.push({ kind: 'set', collection: (ref as MemoryDocRef).collection, id: ref.id, data }); return tx; },
        create: (ref, data) => { writes.push({ kind: 'create', collection: (ref as MemoryDocRef).collection, id: ref.id, data }); return tx; },
        update: (ref, data) => { writes.push({ kind: 'update', collection: (ref as MemoryDocRef).collection, id: ref.id, data }); return tx; },
        delete: (ref) => { writes.push({ kind: 'delete', collection: (ref as MemoryDocRef).collection, id: ref.id, data: {} }); return tx; },
      };
      const result = await body(tx);
      this.apply(writes);
      return result;
    });
  }

  async terminate(): Promise<void> { this.terminated = true; }

  /** For tests: a copy of one document, or undefined. */
  peek(collection: string, id: string): FsData | undefined {
    const d = this.table(collection).get(id);
    return d && structuredClone(d);
  }
}

interface MemoryDocRef extends FsDocRef { readonly collection: string }
interface QueryState { collection: string; filters: { field: string; value: unknown }[]; orderBy?: { field: string; direction: 'asc' | 'desc' }; limit?: number }
interface MemoryQuery extends FsQuery { readonly state: QueryState }

function makeQuery(db: MemoryFirestore, state: QueryState): MemoryQuery {
  const run = () => db.runQuery(state);
  return {
    state,
    where: (field, op, value) => {
      if (op !== '==') throw new Error('Only equality filters are supported.');
      return makeQuery(db, { ...state, filters: [...state.filters, { field, value }] });
    },
    orderBy: (field, direction = 'asc') => makeQuery(db, { ...state, orderBy: { field, direction } }),
    limit: (n) => makeQuery(db, { ...state, limit: n }),
    get: async () => run(),
    count: () => ({ get: async () => { const size = run().size; return { data: () => ({ count: size }) }; } }),
  };
}
