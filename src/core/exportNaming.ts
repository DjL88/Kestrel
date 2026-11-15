export type NumberSource = 'original' | 'sequence';

export interface NameTemplate {
  /** Empty means keep each photo's own name. */
  name: string;
  numbers: NumberSource;
}

export const KEEP_NAMES: NameTemplate = { name: '', numbers: 'original' };

/** The short number a camera put in a file name: the last run of digits, up to four, such as 0107 from DSC_0107.NEF. */
export function shortNumber(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, '');
  const run = /(\d+)(?!.*\d)/.exec(stem)?.[1];
  return run ? run.slice(-4) : null;
}

const cleanName = (value: string) => value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);

/** Numbers 1 to total, padded so they sort: 01 to 12, 001 to 120. At least two digits. */
export function sequenceNumber(index: number, total: number): string {
  return String(index + 1).padStart(Math.max(2, String(total).length), '0');
}

/**
 * The file name (without extension) for one photo, or undefined to keep the photo's own name.
 * Original numbers fall back to the sequence for a photo whose name has no digits.
 */
export function stemFor(template: NameTemplate, filename: string, index: number, total: number): string | undefined {
  const name = cleanName(template.name);
  if (!name) return undefined;
  const number = (template.numbers === 'original' ? shortNumber(filename) : null) ?? sequenceNumber(index, total);
  return total === 1 && template.numbers === 'sequence' ? name : `${name}-${number}`;
}
