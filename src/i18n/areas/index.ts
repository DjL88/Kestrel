import type { AreaEntry } from '../localise';

/**
 * Every area of the app's words, for the completeness tests in `src/core/locale.test.ts`. Each area lives in its own
 * folder: `source.ts` (British English), one file per language, and `index.ts`, which exports the area's words for
 * the session's language and an `AreaEntry`.
 */
export const AREAS: AreaEntry[] = [];
