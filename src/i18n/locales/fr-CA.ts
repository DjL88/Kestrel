import { fr } from './fr';
import type { Translation } from '../messages';

/** Canadian French: start with the European French draft and override Canadian wording as reviewed. */
export const frCA: Translation = {
  ...fr,
  // Untranslated messages still fall back to British English until local review.
};
