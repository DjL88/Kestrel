import { LANGUAGES } from '../../src/core/locale';
import { AREAS } from '../../src/i18n/areas';
import { enGB } from '../../src/i18n/en-GB';
import { TRANSLATIONS } from '../../src/i18n/messages';

/** Every dictionary the app shows words from: the areas under `src/i18n/areas/` and the older shared `messages`. */
export const AUDIT_AREAS = [...AREAS, { name: 'messages', source: enGB, translations: TRANSLATIONS }];

export const AUDIT_LANGUAGES = LANGUAGES.map((item) => item.code);

/**
 * Sections of the older `messages` dictionary that only the first-generation editor (src/components/QuickAdjust,
 * ExifInspector, AppearanceDialog) shows. V2 is the product and does not show them; they retire with that editor.
 * Everything V2 reads from `messages` (Settings → Reading) is still checked.
 */
const RETIRING_V1_SECTIONS = ['quick.', 'photoInfo.', 'appearance.', 'adjustment.'];

export function auditExempt(area: string, key: string): boolean {
  return area === 'messages' && RETIRING_V1_SECTIONS.some((prefix) => key.startsWith(prefix));
}
