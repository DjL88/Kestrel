import { useEffect, useRef, useState } from 'react';
import { applySnapshot, buildSnapshot, parseSnapshot, planApply, syncNameFor, type ProjectSnapshot } from '../core/projectSnapshot';
import { syncPath } from '../core/storageConnectors';
import type { PhotoFrame } from '../core/types';
import { pickSyncFolder } from '../providers/folderConnector';
import { focusBeforeOpening, returnFocus } from './focusReturn';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

interface Props { title: string; projectId: string; frames: PhotoFrame[]; onApply: (frames: PhotoFrame[]) => void; onClose: () => void }

/** Send a project's decisions and edits to a folder you choose, or bring them from one. Nothing leaves the device but into that folder. */
export function SyncFolderDialog({ title, frames, onApply, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<{ snapshot: ProjectSnapshot; matching: number; changed: number; missingHere: number; from: string } | null>(null);
  const previous = useRef<HTMLElement | null>(focusBeforeOpening());
  const heading = useRef<HTMLHeadingElement>(null);
  const name = syncNameFor(title);
  const path = syncPath('recipes', name, 'project');

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const keep = previous.current;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', close, true);
    return () => { document.removeEventListener('keydown', close, true); returnFocus(keep); };
  }, [onClose]);

  async function run(job: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await job(); } catch { setNote('Something went wrong with that folder. Choose it again, or try another.'); } finally { setBusy(false); }
  }

  const send = () => run(async () => {
    const picked = await pickSyncFolder();
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote('This browser cannot pick a folder. Use the Kestrel desktop app, or Chrome or Edge.'); return; }
    const test = await picked.connector.test();
    if (!test.ok) { setNote(test.reason); return; }
    const snapshot = buildSnapshot(title, frames, new Date());
    await picked.connector.put(path, new TextEncoder().encode(JSON.stringify(snapshot)), '');
    setNote(`Saved ${snapshot.photos.length} photos' decisions and edits to “${picked.name}”.`);
  });

  const bring = () => run(async () => {
    const picked = await pickSyncFolder();
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote('This browser cannot pick a folder. Use the Kestrel desktop app, or Chrome or Edge.'); return; }
    const bytes = await picked.connector.get(path);
    const snapshot = bytes ? parseSnapshot(new TextDecoder().decode(bytes)) : null;
    if (!snapshot) { setNote(`“${picked.name}” has no saved copy of “${title}”. Send it from your other device first.`); return; }
    setPending({ snapshot, ...planApply(frames, snapshot), from: picked.name });
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="sync-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">Sync folder</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {pending ? (
            <div className="space-y-3" role="group" aria-label="Confirm bringing changes">
              <p><strong>{pending.changed}</strong> of the <strong>{pending.matching}</strong> matching photos would change here.</p>
              <p>This replaces their decisions, ratings, tags and edits on this device with the saved copy from “{pending.from}”. Photos not in it are left alone{pending.missingHere ? `, and ${pending.missingHere} in it are not in this project` : ''}. Use <strong>Back up project</strong> first if you want a way back.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={!pending.changed} onClick={() => { onApply(applySnapshot(frames, pending.snapshot)); setNote(`Brought ${pending.changed} photos up to date.`); setPending(null); }}>Replace {pending.changed} photos</button>
                <button type="button" className={action} onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p>Keep this project's decisions, ratings, tags and edits in step between your devices through any folder you choose, such as one in iCloud Drive, Dropbox, OneDrive or a shared drive. Only that small file goes into the folder. Your photos are never copied or changed.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => void send()}>Send this project to a folder</button>
                <button type="button" className={action} disabled={busy} onClick={() => void bring()}>Bring changes from a folder</button>
              </div>
              <p className="text-xs text-zinc-400">Photos are matched by name, size and date, so it works even if the files are in different places on each device. Devices with a project of the same name find each other's file.</p>
            </>
          )}
          {note && <p role="status">{note}</p>}
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3"><button type="button" onClick={onClose} className={`${action} w-full`}>Close</button></footer>
      </div>
    </div>
  );
}
