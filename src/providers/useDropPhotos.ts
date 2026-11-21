import { useEffect, useState } from 'react';
import { isSupportedPhotoFilename } from './localShootLoader';

type Entry = { isFile: boolean; isDirectory: boolean; file?: (done: (file: File) => void, fail: () => void) => void; createReader?: () => { readEntries: (done: (items: Entry[]) => void, fail: () => void) => void } };

const fileOf = (entry: Entry) => new Promise<File | null>((resolve) => entry.file!((file) => resolve(file), () => resolve(null)));
const childrenOf = async (entry: Entry) => {
  const reader = entry.createReader!(), all: Entry[] = [];
  // readEntries returns a batch at a time, so keep asking until it is empty.
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) return all;
    all.push(...batch);
  }
};
async function collect(entry: Entry, depth = 0): Promise<File[]> {
  if (entry.isFile) { const file = await fileOf(entry); return file ? [file] : []; }
  if (!entry.isDirectory || depth > 6) return [];
  return (await Promise.all((await childrenOf(entry)).map((child) => collect(child, depth + 1)))).flat();
}

/** The photos in a drop: loose files and everything inside dropped folders. Other file types are left out. */
export async function photosFromDrop(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.()).filter(Boolean) as Entry[];
  const files = entries.length ? (await Promise.all(entries.map((entry) => collect(entry)))).flat() : [...data.files];
  return files.filter((file) => isSupportedPhotoFilename(file.name));
}

/**
 * Accept photos dropped anywhere on the window. A place that handles drops itself, such as the Add photos dialog,
 * marks the event handled and is left alone. Returns whether files are currently being dragged over the window.
 */
export function useDropPhotos(onPhotos: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    let depth = 0;
    const enter = (event: DragEvent) => { if (hasFiles(event)) { depth += 1; setDragging(true); } };
    const leave = (event: DragEvent) => { if (hasFiles(event) && (depth = Math.max(0, depth - 1)) === 0) setDragging(false); };
    // Without this the browser would open the file instead of handing it over.
    const over = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer!.dropEffect = 'copy'; } };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (event.defaultPrevented && (event.target as HTMLElement | null)?.closest?.('[data-handles-drop]')) return;
      void photosFromDrop(event.dataTransfer!).then((files) => {
        if (files.length) { setMessage(null); onPhotos(files); } else setMessage('Those files are not photos Kite44 can open. Drop JPEG, PNG, WebP or camera RAW files.');
      });
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over); window.removeEventListener('drop', drop);
    };
  }, [onPhotos]);
  return { dragging, message, clearMessage: () => setMessage(null) };
}
