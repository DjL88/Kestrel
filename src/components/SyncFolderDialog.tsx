import { useEffect, useRef, useState } from 'react';
import { applySnapshot, buildSnapshot, isNewerHere, looksLikeAnotherProject, parseSnapshot, planApply, syncNameFor, type ProjectSnapshot } from '../core/projectSnapshot';
import { syncPath } from '../core/storageConnectors';
import type { PhotoFrame } from '../core/types';
import { pickSyncFolder, type PickResult } from '../providers/folderConnector';
import { CloudStorageForm } from './CloudStorageForm';
import { loadCloudSettings } from '../providers/cloudSettings';
import { s3Connector } from '../providers/s3Connector';
import { openConnection, useConnections } from '../providers/connectionStore';
import { useProjectLocations } from '../providers/projectLocations';
import type { S3Settings } from '../core/storageConnectors';
import type { StorageConnector } from '../core/storageConnectors';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { projectsText as t } from '../i18n/areas/projects';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

interface Props { title: string; projectId: string; updatedAt?: number; frames: PhotoFrame[]; onApply: (frames: PhotoFrame[]) => void; onClose: () => void }

/** Send a project's decisions and edits to a folder you choose, or bring them from one. Nothing leaves the device but into that folder. */
export function SyncFolderDialog({ title, projectId, updatedAt, frames, onApply, onClose }: Props) {
  const locations = useProjectLocations(projectId);
  const { list: savedConnections } = useConnections();
  const projectPlace = savedConnections.find((connection) => connection.id === (locations.saveTo ?? locations.loadFrom));
  const [where, setWhere] = useState<'folder' | 'cloud' | 'project'>(() => {
    if (locations.saveTo || locations.loadFrom) return 'project';
    try { return localStorage.getItem('kestrel.syncWhere') === 'cloud' ? 'cloud' : 'folder'; } catch { return 'folder'; }
  });
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

  const choose = (next: 'folder' | 'cloud' | 'project') => { setWhere(next); setNote(null); try { localStorage.setItem('kestrel.syncWhere', next); } catch { /* remembered for this session only */ } };

  /** The place to send to or bring from: a folder the person picks, or their own cloud storage. */
  async function chooseLocation(role: 'send' | 'bring' = 'send'): Promise<PickResult> {
    if (where === 'project') {
      const id = role === 'send' ? locations.saveTo ?? locations.loadFrom : locations.loadFrom ?? locations.saveTo;
      const opened = id ? await openConnection(id) : { problem: 'missing' as const, message: t.sync.choosePlaceFirst };
      if ('problem' in opened) { setNote(opened.message); return 'cancelled'; }
      return { connector: opened.connector, name: savedConnections.find((connection) => connection.id === id)?.label ?? t.sync.itsPlace };
    }
    if (where === 'cloud') {
      const settings = cloud ?? loadCloudSettings();
      if (!settings) { setEditingCloud(true); setNote(t.sync.enterDetailsFirst); return 'cancelled'; }
      return { connector: s3Connector(settings), name: settings.bucket };
    }
    return pickSyncFolder();
  }

  async function run(job: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await job(); } catch { setNote(where === 'cloud' ? t.sync.cloudWentWrong : t.sync.folderWentWrong); } finally { setBusy(false); }
  }

  const send = () => run(async () => {
    const picked = await chooseLocation();
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote(t.common.noFolderPicker); return; }
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
    setNote(t.sync.saved(snapshot.photos.length, folder));
  }

  const bring = () => run(async () => {
    const picked = await chooseLocation('bring');
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') { setNote(t.common.noFolderPicker); return; }
    const bytes = await picked.connector.get(path);
    const snapshot = bytes ? parseSnapshot(new TextDecoder().decode(bytes)) : null;
    if (!snapshot) { setNote(t.sync.noCopy(picked.name, title)); return; }
    setPending({ snapshot, ...planApply(frames, snapshot), from: picked.name, another: looksLikeAnotherProject(frames, snapshot, projectId), newerHere: isNewerHere(updatedAt, snapshot) });
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
        if (!order.length) return;
        const at = order.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
      }}>
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="sync-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">{t.sync.title}</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {replacing ? (
            <div className="space-y-3" role="group" aria-label={t.sync.confirmReplaceLabel}>
              <p>{t.sync.replaceStart(replacing.from, replacing.existing.title)}<strong>{t.sync.differentProject}</strong>{t.sync.replaceEnd(replacing.existing.photos.length, new Date(replacing.existing.savedAt).toLocaleString('en-GB'))}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => void run(async () => { await save(replacing.connector, replacing.from); setReplacing(null); })}>{t.sync.replaceCopy}</button>
                <button type="button" className={action} onClick={() => setReplacing(null)}>{t.common.cancel}</button>
              </div>
            </div>
          ) : pending ? (
            <div className="space-y-3" role="group" aria-label={t.sync.confirmBringLabel}>
              {pending.another && <p role="alert" className="text-amber-200">{t.sync.anotherStart}<strong>{t.sync.differentProject}</strong>{t.sync.anotherEnd}</p>}
              {pending.newerHere && <p role="alert" className="text-amber-200">{t.sync.newerStart}<strong>{t.sync.newerStrong}</strong>{t.sync.newerEnd}</p>}
              <p><strong>{pending.changed}</strong>{t.sync.changeOf}<strong>{pending.matching}</strong>{t.sync.changeEnd}</p>
              <p>{t.sync.replacesStart(pending.from, pending.missingHere)}<strong>{t.sync.backUpProject}</strong>{t.sync.replacesEnd}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={!pending.changed} onClick={() => { onApply(applySnapshot(frames, pending.snapshot)); setNote(t.sync.broughtUpToDate(pending.changed)); setPending(null); }}>{pending.another || pending.newerHere ? t.sync.replaceAnyway : t.sync.replaceCount(pending.changed)}</button>
                <button type="button" className={action} onClick={() => setPending(null)}>{t.common.cancel}</button>
              </div>
            </div>
          ) : (
            <>
              <p role="note" className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-amber-100"><strong>{t.sync.experimental}</strong> {t.sync.experimentalBody}</p>
              <div role="radiogroup" aria-label={t.sync.whereLabel} className="flex flex-wrap gap-2">
                {([...(projectPlace ? [['project', t.sync.projectPlace(projectPlace.label)] as const] : []), ['folder', t.sync.aFolder] as const, ['cloud', t.sync.myCloud] as const]).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={where === id} onClick={() => choose(id)}
                    className={`${action} aria-checked:border-sky-300 aria-checked:bg-sky-300/15`}>{label}</button>
                ))}
              </div>
              {where === 'cloud' && (editingCloud || !cloud
                ? <CloudStorageForm initial={cloud} onSaved={(saved) => { setCloud(saved); setEditingCloud(false); setNote(saved ? t.sync.savedNow : t.sync.forgotten); }} onCancel={() => setEditingCloud(false)} />
                : <p role="status">{t.sync.usingBucket}<strong>{cloud.bucket}</strong>{t.sync.atHost(new URL(cloud.endpoint).host)}<button type="button" className="min-h-11 underline" onClick={() => setEditingCloud(true)}>{t.sync.change}</button></p>)}
              <p>{t.sync.explain}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => void send()}>{where === 'cloud' ? t.sync.sendCloud : where === 'project' ? t.sync.sendProject : t.sync.sendFolder}</button>
                <button type="button" className={action} disabled={busy} onClick={() => void bring()}>{where === 'cloud' ? t.sync.bringCloud : where === 'project' ? t.sync.bringProject : t.sync.bringFolder}</button>
              </div>
              <p className="text-xs text-zinc-400">{t.sync.matchNote}</p>
            </>
          )}
          {note && <p role="status">{note}</p>}
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3"><button type="button" onClick={onClose} className={`${action} w-full`}>{t.common.close}</button></footer>
      </div>
    </div>
  );
}
