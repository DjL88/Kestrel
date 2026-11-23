/** Where each format's artboard sits on the "All formats" board, kept with the photo so a tidy arrangement is not lost.
 * Pure and validated on read: anything that is not a finite number in range is ignored, never guessed. */
export type BoardPositions = Record<string, { x: number; y: number }>;

const LIMIT = 4000;
const MAX_BOARDS = 40;

export function readBoard(raw: unknown): BoardPositions {
  const out: BoardPositions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_BOARDS)) {
    if (!id || id.length > 80 || !value || typeof value !== 'object') continue;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = { x: Math.max(-LIMIT, Math.min(LIMIT, Math.round(x))), y: Math.max(-LIMIT, Math.min(LIMIT, Math.round(y))) };
  }
  return out;
}

export function moveArtboard(raw: unknown, sizeId: string, x: number, y: number): BoardPositions | undefined {
  if (!sizeId || !Number.isFinite(x) || !Number.isFinite(y)) return readBoard(raw);
  const next = { ...readBoard(raw), [sizeId]: { x, y } };
  return readBoard(next);
}
