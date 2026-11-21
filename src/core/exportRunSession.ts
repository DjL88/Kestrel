import { exportRunFolder, safeExportName } from './exportPlace';
import { exportFolderName } from './exportBatchQueue';
import type { StorageConnector } from './storageConnectors';

/**
 * Keeps one export run's destination independent of the dialog that created it.
 * Every run has a unique folder ID, so earlier files are not silently replaced.
 * The storage connector is user-approved before this session is created.
 */
export function createExportRunSession(
  connector: Pick<StorageConnector, 'put'>, at: Date, runId: string,
) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId)) {
    throw new Error('Invalid export run identifier.');
  }
  const folder = exportRunFolder(at, runId);
  return {
    folder,
    async save(file: File, subfolder: string, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const name = safeExportName(file.name);
      if (name !== file.name) throw new Error('The export filename contains unsafe characters.');
      const sub = subfolder ? `${exportFolderName(subfolder)}/` : '';
      const path = `${folder}/${sub}${name}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      signal.throwIfAborted();
      await connector.put(path, bytes, '');
      // A successful PUT stays saved even if Stop was pressed during it.
      // The queue checks cancellation before starting another output.
    },
  };
}
