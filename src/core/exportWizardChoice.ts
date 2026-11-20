import { EXPORT_FORMATS, type ExportFormat } from './exportFormats';

/**
 * A destination with exactly one format should not require another "choose
 * size" screen. The photo, crop and final export checks are still shown.
 * Keep this logic independent of React so keyboard and touch share it.
 */
export type ExportWizardPage = 'size' | 'position' | 'review';

export function exportDestinationFormats(
  destinationId: string,
  formats: readonly ExportFormat[] = EXPORT_FORMATS,
): readonly ExportFormat[] {
  if (destinationId === 'custom') return [];
  return formats.filter((format) => (
    destinationId === 'master' || destinationId === 'full-jpeg' || destinationId === 'before-after'
      ? format.id === destinationId
      : format.platform === destinationId
  ));
}

export function chooseExportDestination(
  destinationId: string,
  formats: readonly ExportFormat[] = EXPORT_FORMATS,
): { selectedFormat: string | null; page: ExportWizardPage } {
  const options = exportDestinationFormats(destinationId, formats);
  if (options.length !== 1) return { selectedFormat: null, page: 'size' };
  const format = options[0];
  // A full image (or a deliberate paired before/after) needs no crop chooser.
  const cropScreenNeeded = format.width > 0 && format.height > 0 &&
    format.id !== 'before-after' && format.fit !== 'keep';
  return { selectedFormat: format.id, page: cropScreenNeeded ? 'position' : 'review' };
}
