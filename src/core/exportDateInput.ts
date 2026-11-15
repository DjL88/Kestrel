/** A custom photo date must be selected before starting an expensive batch export. */
export function parseCustomExportDate(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
