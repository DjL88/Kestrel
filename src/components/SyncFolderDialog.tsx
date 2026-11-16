import { useEffect, useRef, useState } from 'react';
import { applySnapshot, buildSnapshot, isNewerHere, looksLikeAnotherProject, parseSnapshot, planApply, syncNameFor, type ProjectSnapshot } from '../core/projectSnapshot';
import { syncPath } from '../core/storageConnectors';
import type { PhotoFrame } from '../core/types';
import { pickSyncFolder, type PickResult } from '../providers/folderConnector';
import { CloudStorageForm } from './CloudStorageForm';
import { loadCloudSettings } from '../providers/cloudSettings';
import { s3Connector } from '../providers/s3Connector';
import type { S3Settings } from '../core/storageConnectors';
import type { StorageConnector } from '../core/storageConnectors';
import { focusBeforeOpening, returnFocus } from './focusReturn';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

interface Props { title: string; projectId: string; updatedAt?: number; frames: PhotoFrame[]; onApply: (frames: PhotoFrame[]) => void; onClose: () => void }

/** Send a project's decisions and edits to a folder you choose, or bring them from one. Nothing leaves the device but into that folder. */
export function SyncFolderDialog({ title, projectId, updatedAt, frames, onApply, onClose }: Props) {
  const [where, setWhere] = useState<'folder' | 'cloud'>(() => { try { return localStorage.getItem('kestrel.syncWhere') === 'cloud' ? 'cloud' : 'folder'; } catch { return 'folder'; } });
  const [cloud, setCloud] = useState<S3Settings | null>(() => loadCloudSettings());
  const [editingCloud, setEditingCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<{ snapshot: ProjectSnapshot; matching: number; changed: number; missingHere: number; from: string; another: boolean; newerHere: boolean } | null>(null);
  const [replacing, setReplacing] = useState<{ connector: StorageConnector; existing: ProjectSnapshot; from: string } | null>(null);
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

  const choose = (next: 'folder' | 'cloud') => { setWhere(next); setNote(null); try { localStorage.setItem('kestrel.syncWhere', next); } catch { /* remembered for this session only */ } };

  /** The place to send to or bring from: a folder the person picks, or their own cloud storage. */
  async function chooseLocation(): Promise<PickResult> {
    if (where === 'cloud') {
      const settings = cloud ?? loadCloudSettings();
      if (!settings) { setEditingCloud(true); setNote('Enter your storage details first.'); return 'cancelled'; }
      return { connector: s3Connector(settings), name: settings.bucket };
    }
    return pickSyncFolder();
  }

  async function run(job: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await job(); } catch { setNote(where === 'cloud' ? 'Something went wrong with your cloud storage. Test the connection in its settings.' : 'Something went wrong with that folder. Choose it again, or try another.'); } finally { setBusy(false); }
  }

  const send = () => run(async () => {
    const picked = await chooseLocation();
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote('This browser cannot pick a folder. Use the Kestrel desktop app, or Chrome or Edge.'); return; }
    const test = await picked.connector.test();
    if (!test.ok) { setNote(test.reason); return; }
    // Two projects with the same title share a file name. Never replace another project's copy without asking.
    const existingBytes = await picked.connector.get(path);
    const existing = existingBytes ? parseSnapshot(new TextDecoder().decode(existingBytes)) : null;
    if (existing && looksLikeAnotherProject(frames, existing, projectId)) { setReplacing({ connector: picked.connector, existing, from: picked.name }); return; }
    await save(picked.connector, picked.name);
  });

  async function save(connector: StorageConnector, folder: string) {
    const snapshot = buildSnapshot(title, frames, new Date(), projectId);
    await connector.put(path, new TextEncoder().encode(JSON.stringify(snapshot)), '');
    setNote(`Saved ${snapshot.photos.length} photos' decisions and edits to “${folder}”.`);
  }

  const bring = () => run(async () => {
    const picked = await chooseLocation();
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote('This browser cannot pick a folder. Use the Kestrel desktop app, or Chrome or Edge.'); return; }
    const bytes = await picked.connector.get(path);
    const snapshot = bytes ? parseSnapshot(new TextDecoder().decode(bytes)) : null;
    if (!snapshot) { setNote(`“${picked.name}” has no saved copy of “${title}”. Send it from your other device first.`); return; }
    setPending({ snapshot, ...planApply(frames, snapshot), from: picked.name, another: looksLikeAnotherProject(frames, snapshot, projectId), newerHere: isNewerHere(updatedAt, snapshot) });
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="sync-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">Sync folder or cloud</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {replacing ? (
            <div className="space-y-3" role="group" aria-label="Confirm replacing a saved copy">
              <p>“{replacing.from}” already holds a saved copy called “{replacing.existing.title}” that looks like a <strong>different project</strong> ({replacing.existing.photos.length} photos, saved {new Date(replacing.existing.savedAt).toLocaleString('en-GB')}). Sending this project would replace it.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => void run(async () => { await save(replacing.connector, replacing.from); setReplacing(null); })}>Replace that copy</button>
                <button type="button" className={action} onClick={() => setReplacing(null)}>Cancel</button>
              </div>
            </div>
          ) : pending ? (
            <div className="space-y-3" role="group" aria-label="Confirm bringing changes">
              {pending.another && <p role="alert" className="text-amber-200">This saved copy looks like a <strong>different project</strong>: few of its photos are in this one. Check you chose the right folder.</p>}
              {pending.newerHere && <p role="alert" className="text-amber-200">You changed this project on this device <strong>after</strong> that copy was saved. Bringing it would undo your newer work here.</p>}
              <p><strong>{pending.changed}</strong> of the <strong>{pending.matching}</strong> matching photos would change here.</p>
              <p>This replaces their decisions, ratings, tags and edits on this device with the saved copy from “{pending.from}”. Photos not in it are left alone{pending.missingHere ? `, and ${pending.missingHere} in it are not in this project` : ''}. Use <strong>Back up project</strong> first if you want a way back.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={!pending.changed} onClick={() => { onApply(applySnapshot(frames, pending.snapshot)); setNote(`Brought ${pending.changed} photos up to date.`); setPending(null); }}>{pending.another || pending.newerHere ? 'Replace anyway' : `Replace ${pending.changed} photos`}</button>
                <button type="button" className={action} onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p role="note" className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-amber-100"><strong>Experimental.</strong> This is a manual hand-over, not automatic sync, and it has not been tested on every system. Back up the project first.</p>
              <div role="radiogroup" aria-label="Where to keep the synced file" className="flex flex-wrap gap-2">
                {([['folder', 'A folder'], ['cloud', 'My cloud storage']] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={where === id} onClick={() => choose(id)}
                    className={`${action} aria-checked:border-sky-300 aria-checked:bg-sky-300/15`}>{label}</button>
                ))}
              </div>
              {where === 'cloud' && (editingCloud || !cloud
                ? <CloudStorageForm initial={cloud} onSaved={(saved) => { setCloud(saved); setEditingCloud(false); setNote(saved ? 'Saved. You can send and bring now.' : 'Forgotten.'); }} onCancel={() => setEditingCloud(false)} />
                : <p role="status">Using bucket <strong>{cloud.bucket}</strong> at {new URL(cloud.endpoint).host}. <button type="button" className="min-h-11 underline" onClick={() => setEditingCloud(true)}>Change</button></p>)}
              <p>Keep this project's decisions, ratings, tags and edits in step between your devices through any folder you choose, such as one in iCloud Drive, Dropbox, OneDrive or a shared drive. Only that small file goes into the folder. Your photos are never copied or changed.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => void send()}>{where === 'cloud' ? 'Send this project to my cloud storage' : 'Send this project to a folder'}</button>
                <button type="button" className={action} disabled={busy} onClick={() => void bring()}>{where === 'cloud' ? 'Bring changes from my cloud storage' : 'Bring changes from a folder'}</button>
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
