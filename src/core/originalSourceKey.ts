/**
 * A link to a file on disk must not be confused with another file just
 * because two cameras produced DSC_0001.NEF with the same size and date.
 *
 * All saved local-file:// keys remain valid. Only newly imported files with
 * an actual linked path use this path-qualified v2 key. The final two "::"
 * components deliberately keep size/time readable by old catalogue loaders.
 * This is a lexical path identity, NOT an assertion that symlinks, junctions,
 * network aliases or hardlinks are different physical files.
 */
export interface OriginalKeySource {
  name: string;
  size: number;
  lastModified: number;
  path?: string;
}
export const legacyOriginalKey = ({ name, size, lastModified }: OriginalKeySource): string =>
  `local-file://${name}::${size}::${lastModified}`;

/** Canonicalise familiar spellings, without resolving filesystem aliases. */
export function linkedPathIdentity(path: string): string {
  const value = path.trim().normalize('NFC').replace(/\\/g, '/');
  if (!value) return '';
  const isWindows = /^[a-zA-Z]:\//.test(value) || value.startsWith('//');
  const prefix = isWindows ? 'win:' : 'posix:';
  // Keep UNC's two leading slashes; never mistake it for a POSIX path.
  const leading = value.startsWith('//') ? '//' : value.startsWith('/') ? '/' : '';
  const body = value.slice(leading.length).replace(/\/+/g, '/');
  const lexical = (leading + body).replace(/\/$/, '').normalize('NFC');
  // Never fold directory names to lower case: modern Windows supports
  // per-directory case sensitivity and a NAS may expose case-sensitive paths.
  // Two distinct files must not collide merely because their names differ in case.
  // Normalising slash direction is safe; resolving path aliases requires the OS.
  return prefix + (isWindows && /^[a-zA-Z]:\//.test(lexical)
    ? lexical[0].toUpperCase() + lexical.slice(1)
    : lexical);
}

export function originalSourceKey(photo: OriginalKeySource): string {
  if (!photo.path?.trim()) return legacyOriginalKey(photo);
  const path = linkedPathIdentity(photo.path);
  if (!path) return legacyOriginalKey(photo);
  return `local-linked://${encodeURIComponent(path)}::${photo.name}::${photo.size}::${photo.lastModified}`;
}
