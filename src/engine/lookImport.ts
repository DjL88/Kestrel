import { LOCAL_KEYS, type LocalKey } from '../core/maskTypes';
import type { EngineCapability } from './types';
import type { Look, LookStep } from './looks';

/**
 * "Create and import your own Looks" (owner backlog round 3, item 22, #418: "a Look is a macro ...
 * E: src/engine/looks.ts; FE: create, import, preview, apply"). `looks.ts` already has the real shape
 * and the real run-and-verify loop (`runLook`); what was missing is the engine-side half of IMPORT -
 * turning untrusted JSON (pasted, or a file someone downloaded) into a `Look` the rest of the engine can
 * actually run, without trusting a single field of it. `serializeLook` is the matching export half, kept
 * here rather than left as a bare `JSON.stringify` so export and import always agree on the exact shape.
 *
 * Deliberately conservative, in the same spirit as `maskTypes.ts`'s `validMasks`: every numeric field is
 * range-checked against the real `PhotoEdit`/`LocalKey` bounds, every capability must be one this engine
 * actually has, and an imported Look is always re-tagged `source: 'user'` - whatever the JSON claims,
 * nothing imported from outside this session is allowed to call itself `'builtin'` or `'engine-suggested'`,
 * since either would misrepresent where the Look actually came from. Anything that fails any check
 * returns null; nothing is guessed or partially repaired.
 */

const MAX_STEPS = 8;
const MAX_STRING = 120;
const REAL_CAPABILITIES: ReadonlySet<EngineCapability> = new Set(['raw-develop', 'vision-scene', 'subject-detect', 'denoise', 'mask', 'upscale']);

const finite = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

const isShortString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING;

/** Every key must be a real `LocalKey` and every value within the same bounds `maskTypes.ts`'s
 * `validMasks` enforces for a mask edit (denoise 0 to 2, everything else -2 to 2) - a Look step's
 * `background`/`subject` is the same kind of numeric edit, just not wrapped in a `Mask`. */
function validLocalEdit(value: unknown): value is Partial<Record<LocalKey, number>> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).every(([key, num]) => (LOCAL_KEYS as readonly string[]).includes(key) && finite(num, key === 'denoise' ? 0 : -2, 2));
}

function validStep(value: unknown): value is LookStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  if (!isShortString(step.label)) return false;
  if (typeof step.capability !== 'string' || !REAL_CAPABILITIES.has(step.capability as EngineCapability)) return false;
  if (!validLocalEdit(step.background)) return false;
  if (step.subject !== undefined && !validLocalEdit(step.subject)) return false;
  return true;
}

/** Parses and validates a Look previously produced by `serializeLook` (or built by hand to the same
 * shape). Returns null, never a guessed or partially-fixed Look, on any malformed, out-of-range or
 * unrecognised field - including a `source` or `capability` this engine does not actually have. */
export function parseLook(json: string): Look | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isShortString(candidate.id) || !isShortString(candidate.name) || typeof candidate.description !== 'string' || candidate.description.length > 500) return null;
  if (!Array.isArray(candidate.steps) || candidate.steps.length < 1 || candidate.steps.length > MAX_STEPS) return null;
  if (!candidate.steps.every(validStep)) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    steps: candidate.steps as LookStep[],
    // Always 'user', regardless of what the JSON says - see file header.
    source: 'user',
  };
}

/** The matching export half - deliberately just the Look's own real fields, nothing else, so a round
 * trip through `serializeLook` then `parseLook` is lossless for anything that was valid to begin with. */
export function serializeLook(look: Look): string {
  const { id, name, description, steps } = look;
  return JSON.stringify({ id, name, description, steps });
}
