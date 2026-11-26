/**
 * Live shoot room (offline, on the local network): people watching on another screen can star and pick. Their marks
 * arrive as small untrusted text; this reads them and combines them with the photographer's own using the same rules as
 * shared projects (sharedMarks.mergeShared), so a change the photographer made meanwhile is never overwritten. Pure.
 */
import { mergeShared, readSharedMarks, sameMarks, type SharedMarks } from './sharedMarks';

export interface RoomMark { id: string; base: SharedMarks; marks: SharedMarks }

/** One mark as the room's page sent it; null when it is not exactly what the page sends. */
export function readRoomMark(text: string): RoomMark | null {
  if (typeof text !== 'string' || text.length > 1024) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.id)) return null;
  const base = readSharedMarks(v.base);
  const marks = readSharedMarks(v.marks);
  return base && marks ? { id: v.id, base, marks } : null;
}

export type RoomMarkOutcome =
  /** Take these marks (the room changed something the photographer had not). */
  | { kind: 'apply'; marks: SharedMarks }
  /** Nothing changes. */
  | { kind: 'same' }
  /** The photographer changed the same thing meanwhile: theirs stays, and the app says so. */
  | { kind: 'kept-photographer' };

export function combineRoomMark(current: SharedMarks, mark: RoomMark): RoomMarkOutcome {
  const result = mergeShared({ editHash: '', marks: mark.base }, { edit: null, marks: current }, { edit: null, marks: mark.marks });
  if (result.kind === 'conflict') return { kind: 'kept-photographer' };
  return sameMarks(result.marks, current) ? { kind: 'same' } : { kind: 'apply', marks: result.marks };
}

/** Letters and digits only, long enough that the room's link cannot be guessed. */
export function roomKey(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  while (out.length < 24) {
    for (const byte of random(new Uint8Array(48))) {
      if (byte < 256 - (256 % alphabet.length) && out.length < 24) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

export interface RoomLink { address: string; url: string }

/** The links to open on another screen, one per address this computer has on the network. */
export function roomLinks(addresses: readonly string[], port: number, key: string): RoomLink[] {
  return addresses.map((address) => ({ address, url: `http://${address}:${port}/?k=${key}` }));
}
