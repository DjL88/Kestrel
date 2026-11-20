import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PhotoEditor, type EditorTab } from '../components/PhotoEditor';
import { Filmstrip } from '../components/Filmstrip';
import { FilmstripDock } from '../components/FilmstripDock';
import { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { DEFAULT_KEY_BINDINGS } from '../core/keyboardCommands';
import { DEFAULT_EDIT, type PhotoEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, type PhotoFraming } from '../core/photoFraming';
import { recordEdit, stepEdit, jumpToStep } from '../core/editHistory';
import type { PhotoFrame } from '../core/types';

interface Example {
  id: string;
  title: string;
  subject: string;
  credit: string;
  alt: string;
  imageUrl?: string | null;
  published: boolean;
  revision: number;
  edit?: PhotoEdit;
  framing?: PhotoFraming;
}
interface ActivePhoto { meta: Example; frame: PhotoFrame }
const adminMode = new URLSearchParams(location.search).get('admin') === '1';

async function api(path: string, token: string | null, body?: unknown) {
  const res = await fetch('/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('The demo service is not yet available.');
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message ?? 'The demo service could not complete the request.');
  return result;
}
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this photograph.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
/** A limited-size JPEG redrawn without camera EXIF/GPS; the original never leaves the browser. */
async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG or another supported photograph.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 320 || bitmap.height < 320) throw new Error('Choose a photograph at least 320 pixels in each direction.');
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this photograph.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.83));
    canvas.width = 0; canvas.height = 0;
    if (!jpeg || jpeg.size > 1_600_000) throw new Error('This photograph is too large after resizing. Try a smaller file.');
    return toBase64(jpeg);
  } finally { bitmap.close(); }
}
function asFrame(photo: Example, index: number): PhotoFrame {
  return {
    id: photo.id, stableKey: 'website-example:' + photo.id,
    filename: photo.title + '.jpg', sequenceIndex: index + 1,
    decision: 'unreviewed', burstGroupId: null, burstIndex: 0, burstCount: 1,
    exif: { formatLabel: 'Approved JPEG example' },
    isDemo: true, sourceKind: 'file',
    subjectNames: photo.subject ? [photo.subject] : [],
    tags: photo.subject ? [photo.subject] : [],
    edit: photo.edit ?? { ...DEFAULT_EDIT },
    framing: photo.framing ?? { ...DEFAULT_FRAMING },
  };
}
export function DemoEditorApp() {
  const provider = useRef<BrowserPreviewProvider | null>(null);
  if (!provider.current) provider.current = new BrowserPreviewProvider();
  const [photos, setPhotos] = useState<ActivePhoto[]>([]);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<EditorTab>('edit');
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState('Loading approved photographs…');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [alt, setAlt] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!adminMode || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (event.data?.type !== 'kestrel-demo-auth') return;
      setToken(typeof event.data.token === 'string' && event.data.token.length > 50 ? event.data.token : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const refresh = useCallback(async (auth: string | null, keepId?: string) => {
    setMessage('Loading approved photographs…');
    const result = await api(auth && adminMode ? 'admin/demo/photos' : 'demo/photos', auth && adminMode ? auth : null);
    const entries = (result.photos as Example[]).slice(0, 40);
    const next: ActivePhoto[] = [];
    for (const [index, photo] of entries.entries()) {
      try {
        let blob: Blob;
        if (photo.imageUrl) {
          const response = await fetch(photo.imageUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error('Image is unavailable.');
          blob = await response.blob();
        } else if (auth && adminMode) {
          const raw = await api('admin/demo/photos/' + encodeURIComponent(photo.id) + '/image', auth);
          const bytes = Uint8Array.from(atob(raw.jpegBase64), (char) => char.charCodeAt(0));
          blob = new Blob([bytes], { type: 'image/jpeg' });
        } else continue;
        const frame = asFrame(photo, index);
        provider.current!.registerBlob(frame.stableKey, blob);
        next.push({ meta: photo, frame });
      } catch { /* An unavailable image must not hide the other approved photographs. */ }
    }
    setPhotos(next);
    setSelected(next.find((p) => p.meta.id === keepId)?.meta.id ?? next[0]?.meta.id ?? '');
    setDirty(false);
    setMessage(next.length ? '' : auth && adminMode ? 'Upload your first approved photograph.' : 'Curated photographs are being prepared.');
  }, []);

  useEffect(() => { void refresh(token).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load photographs.')); }, [refresh, token]);
  const active = photos.find((p) => p.meta.id === selected);
  useEffect(() => {
    setSubject(active?.meta.subject ?? '');
    setTitle(active?.meta.title ?? '');
    setCredit(active?.meta.credit ?? '');
    setAlt(active?.meta.alt ?? '');
    setDirty(false);
  }, [selected, active?.meta.revision]);

  const updateFrame = useCallback((update: (frame: PhotoFrame) => PhotoFrame) => {
    setPhotos((previous) => previous.map((p) => p.meta.id === selected ? { ...p, frame: update(p.frame) } : p));
    if (adminMode && token) setDirty(true);
  }, [selected, token]);
  const setEdit = (edit: PhotoEdit) => updateFrame((frame) => recordEdit(frame, { edit }, Date.now()));
  const setFraming = (framing: PhotoFraming) => updateFrame((frame) => recordEdit(frame, { framing }, Date.now()));

  async function adminAction(action: () => Promise<string | undefined>) {
    if (!token || busy) return;
    setBusy(true);
    try {
      const keep = await action();
      await refresh(token, keep ?? selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not complete the request.');
    } finally { setBusy(false); }
  }
  function upload(file: File) {
    void adminAction(async () => {
      const jpegBase64 = await preparePhoto(file);
      const result = await api('admin/demo/photos', token, {
        jpegBase64, title: file.name.replace(/\.[^.]+$/, '').slice(0, 80),
        subject: 'Unlabelled', credit: '', alt: file.name.slice(0, 140),
      });
      return result.photo.id as string;
    });
  }
  function save() {
    void adminAction(async () => {
      if (!active) return undefined;
      await api('admin/demo/photos/' + encodeURIComponent(active.meta.id) + '/save', token, {
        revision: active.meta.revision, title, subject, credit, alt,
        edit: active.frame.edit ?? DEFAULT_EDIT,
        framing: active.frame.framing ?? DEFAULT_FRAMING,
      });
      return active.meta.id;
    });
  }
  function publish() {
    void adminAction(async () => {
      if (!active) return undefined;
      if (dirty) throw new Error('Save the edits and subject details before publishing.');
      await api('admin/demo/photos/' + encodeURIComponent(active.meta.id) + '/publish', token,
        { revision: active.meta.revision, published: !active.meta.published });
      return active.meta.id;
    });
  }
  function remove() {
    void adminAction(async () => {
      if (!active) return undefined;
      if (!window.confirm('Permanently delete this example and remove it from the public demo?')) return active.meta.id;
      await api('admin/demo/photos/' + encodeURIComponent(active.meta.id) + '/delete', token, { revision: active.meta.revision });
      return '';
    });
  }
  return (
    <div className="flex h-[100dvh] min-h-[520px] w-full flex-col overflow-hidden bg-[#111318] text-zinc-100">
      <header className="flex min-h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-white/10 bg-[#1a1d23] px-3 text-sm">
        <strong className="font-semibold tracking-wide">Kestrel</strong>
        <span className="text-zinc-500">/</span><span className="font-semibold">Edit</span>
        <span className="ml-auto max-w-[35%] truncate text-xs text-zinc-400">{active?.meta.title ?? 'Selected photographs'}</span>
      </header>
      {adminMode && token && (
        <section className="shrink-0 space-y-2 border-b border-white/10 bg-[#1b2027] p-3 text-sm" aria-label="Private Demo Studio">
          <div className="flex flex-wrap items-center gap-2">
            <strong>Demo Studio</strong><span className="text-xs text-zinc-400">Private owner controls</span>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="ml-auto rounded-md border border-white/25 px-3 py-2">Upload photograph</button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file);
            }} />
            <button type="button" onClick={save} disabled={busy || !active || !dirty} className="rounded-md border border-white/25 px-3 py-2">Save settings</button>
            <button type="button" onClick={publish} disabled={busy || !active || dirty} className="rounded-md bg-amber-700 px-3 py-2 font-semibold">
              {active?.meta.published ? 'Unpublish' : 'Publish'}
            </button>
            <button type="button" onClick={remove} disabled={busy || !active} className="rounded-md border border-rose-500 px-3 py-2">Delete</button>
          </div>
          {active && <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <label className="text-xs text-zinc-300">Photo title<input className="mt-1 w-full rounded-md border border-white/20 bg-[#101318] px-2 py-2" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }}/></label>
            <label className="text-xs text-zinc-300">Subject tag<input className="mt-1 w-full rounded-md border border-white/20 bg-[#101318] px-2 py-2" value={subject} onChange={(event) => { setSubject(event.target.value); setDirty(true); }}/></label>
            <label className="text-xs text-zinc-300">Image description<input className="mt-1 w-full rounded-md border border-white/20 bg-[#101318] px-2 py-2" value={alt} onChange={(event) => { setAlt(event.target.value); setDirty(true); }}/></label>
            <label className="text-xs text-zinc-300">Photo credit<input className="mt-1 w-full rounded-md border border-white/20 bg-[#101318] px-2 py-2" value={credit} onChange={(event) => { setCredit(event.target.value); setDirty(true); }}/></label>
          </div>}
          {active && <span className="text-xs text-zinc-400">{active.meta.published ? 'Public example' : 'Private draft'} · Revision {active.meta.revision}{dirty ? ' · Unsaved changes' : ''}</span>}
        </section>
      )}
      {message && <p role="status" className="shrink-0 border-b border-white/10 bg-[#21232b] px-3 py-2 text-sm text-amber-200">{message}</p>}
      {active ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <PhotoEditor key={active.frame.id} demoOnly frame={active.frame} provider={provider.current!}
            needsAccess={false} bindings={DEFAULT_KEY_BINDINGS} initialTab={tab} onTabChange={setTab}
            onEdit={setEdit} onApplyLook={setEdit}
            onHistoryStep={(direction) => updateFrame((frame) => stepEdit(frame, direction))}
            onHistoryJump={(cursor) => updateFrame((frame) => jumpToStep(frame, cursor))}
            copiedEdit={null} onCopyEdit={() => {}} keeperCount={1}
            onCreateVirtualCopy={() => {}} onFocusPoint={(point) => updateFrame((frame) => ({ ...frame, focusPoint: point }))}
            onFramingChange={setFraming} onApplyToKeepers={() => {}}
            panelSide="right" onPanelSideChange={() => {}} />
          <FilmstripDock expanded={expanded} onToggle={() => setExpanded((v) => !v)}>
            <Filmstrip frames={photos.map((p) => p.frame)} selectedFrameId={selected}
              previewProvider={provider.current!} needsAccess={false} onSelectFrame={setSelected} />
          </FilmstripDock>
        </div>
      ) : <div className="min-h-0 flex-1 p-6 text-sm text-zinc-300">
        {adminMode && !token ? 'Sign in through the Kestrel admin console to manage examples.' : 'No published photographs are available yet.'}
      </div>}
      <p className="shrink-0 border-t border-white/10 bg-[#1a1d23] px-3 py-1 text-[11px] text-zinc-400">
        Real Kestrel editor · fixed JPEG examples · no import or export · visitor changes are temporary
      </p>
    </div>
  );
}
