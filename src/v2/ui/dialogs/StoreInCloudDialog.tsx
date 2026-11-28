import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatBytes, type CloudUsage } from '../../../core/cloudPlan';
import { CLOUD_ORIGINAL_MAX_BYTES, STORE_FILTERS, originalsBytes, photosToStore, storeEstimate, type StoreFilter } from '../../../core/storeInCloud';
import { tasks } from '../../../core/taskStore';
import { CollabError, type CollabClient } from '../../../providers/collabClient';
import { galleryThumbnail } from '../../engineClient/galleryThumbnail';
import { readStoreChoice, writeStoreChoice } from '../../engineClient/storeInCloudChoice';
import { STRINGS } from '../strings';
import { markOwnCloudProject, readSharedLink, writeSharedLink } from './sharedLinks';

export interface StorablePhoto { id: string; sharedKey?: string; filename: string; cloudPreview?: boolean; decision?: string | null; sharpnessScore?: number; rating?: number; speciesName?: string; category?: string;
  photoTags?: { label: string; words: string[] }[]; exif?: { fileSizeMb?: number } }

interface StoreInCloudDialogProps {
  open: boolean;
  client: CollabClient;
  localProjectId: string | null;
  projectName: string;
  photos: StorablePhoto[];
  selectedPhotoIds: string[];
  displayName: () => Promise<string | null>;
  renderPreview?: (photoId: string) => Promise<Blob | null>;
  /**
   * The photo's own original file, checked against its fingerprint, or null when it cannot be read here. Given only when
   * storing originals is switched on (preview flag); without it, only sized previews go up and the dialog says so.
   */
  readOriginal?: (photoId: string) => Promise<Blob | null>;
  /** The account's numbers, as Settings › Account shows them. */
  usage?: CloudUsage;
  onTopUp: () => void;
  /** Stored or removed: the photos' cloud marks and the account's numbers may have changed. */
  onChanged?: () => void;
  onClose: () => void;
}

const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50';
const primary = 'min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)] disabled:opacity-50';

/**
 * Store in the cloud (Dave, 27 Nov): a cloud copy of the chosen photos so they open on your other devices. One filter,
 * the size against your storage before you confirm, and Remove from the cloud in the same place. Sized previews go up,
 * never originals. It uses the cloud photo store that shared projects already have; nobody else is invited.
 */
export default function StoreInCloudDialog({ open, client, localProjectId, projectName, photos, selectedPhotoIds, displayName, renderPreview, readOriginal, usage, onTopUp, onChanged, onClose }: StoreInCloudDialogProps) {
  const t = STRINGS.storeCloud;
  const [choice, setChoice] = useState(() => readStoreChoice(localProjectId));
  const { filter, top, tag, minRating } = choice;
  const change = (next: Partial<typeof choice>) => setChoice((current) => ({ ...current, ...next }));
  const withOriginals = Boolean(readOriginal) && choice.originals;
  /** Photo keys the cloud holds for this project, and whether each also holds its original. Null until asked. */
  const [stored, setStored] = useState<Map<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [full, setFull] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const stop = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const linked = localProjectId ? readSharedLink(localProjectId) : null;
    setListFailed(false);
    if (!linked) { setStored(new Map()); return; }
    // A failed listing must never look like an empty cloud (that would offer to send everything again): say so instead.
    try { setStored(new Map((await client.cloudPhotos(linked)).map((photo) => [photo.photoKey, photo.originalBytes != null]))); }
    catch { setStored(null); setListFailed(true); }
  }, [client, localProjectId]);
  // Declared first so it runs before the dialog takes focus: the opener is what focus returns to on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { previous?.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setMessage(''); setFull(false); setConfirmRemove(false); setStored(null);
    // What was chosen last time comes back, so a stopped run is one press from being finished.
    setChoice(readStoreChoice(localProjectId));
    void load();
    closeButton.current?.focus();
  }, [open, load, localProjectId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      // Keep Tab inside the dialog.
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, busy, onClose]);
  if (!open) return null;

  // A photo that is itself a cloud preview came from the cloud; it is not sent back.
  const storable = photos.filter((photo) => photo.sharedKey && !photo.cloudPreview);
  // Photos picked by hand: what is selected now, or, with nothing selected, what was picked last time.
  const manualIds = selectedPhotoIds.length ? selectedPhotoIds : choice.selectedIds;
  const tagsOf = (photo: StorablePhoto) => [photo.speciesName, photo.category, ...(photo.photoTags ?? []).flatMap((entry) => [entry.label, ...entry.words])].filter((word): word is string => Boolean(word));
  const covered = new Set(photosToStore(filter, storable.map((photo) => ({ id: photo.id, decision: photo.decision, rating: photo.rating, tags: tagsOf(photo), cullScore: photo.sharpnessScore && photo.sharpnessScore > 0 ? photo.sharpnessScore : undefined })), { selectedIds: manualIds, top, tag, minRating }));
  const chosen = storable.filter((photo) => covered.has(photo.id));
  // With originals on, a photo whose preview is already up but not its original is still to do.
  const toStore = chosen.filter((photo) => !stored?.has(photo.sharedKey!) || (withOriginals && stored.get(photo.sharedKey!) === false));
  const toRemove = chosen.filter((photo) => stored?.has(photo.sharedKey!));
  const needOriginals = withOriginals ? toStore.filter((photo) => stored?.get(photo.sharedKey!) !== true) : [];
  const originalsSize = originalsBytes(needOriginals.map((photo) => ({ fileSizeMb: photo.exif?.fileSizeMb })));
  const estimate = usage ? storeEstimate(toStore.filter((photo) => !stored?.has(photo.sharedKey!)).length, usage, originalsSize) : null;
  const plainSize = formatBytes((toStore.filter((photo) => !stored?.has(photo.sharedKey!)).length * 1_000_000) + originalsSize);

  const store = async () => {
    if (!localProjectId || !renderPreview || !toStore.length) return;
    // The choice is kept before anything is sent, so it survives a stop, a failure or a restart.
    writeStoreChoice(localProjectId, { ...choice, selectedIds: filter === 'selected' ? [...manualIds] : choice.selectedIds });
    setBusy(true); setMessage(''); setFull(false);
    const abort = new AbortController();
    stop.current = abort;
    const row = tasks.start(t.taskTitle, { total: toStore.length, kind: 'cloud', location: 'cloud', priority: 1, cancel: () => abort.abort() });
    let done = 0;
    let skipped = 0;
    let originalsUnread = 0;
    try {
      let linked = readSharedLink(localProjectId);
      if (!linked) {
        linked = await client.create(projectName.trim() || t.defaultProjectName, (await displayName()) ?? t.defaultMemberName);
        writeSharedLink(localProjectId, linked);
        markOwnCloudProject(localProjectId);
      }
      for (const photo of toStore) {
        if (abort.signal.aborted) break;
        if (!stored?.has(photo.sharedKey!)) {
          const preview = await renderPreview(photo.id);
          if (!preview) { skipped += 1; row.progress(done, toStore.length, t.progress(done, toStore.length)); continue; }
          const thumb = await galleryThumbnail(preview);
          if (thumb) await client.cloudUpload(linked, photo.sharedKey!, 'thumb', thumb, photo.filename);
          await client.cloudUpload(linked, photo.sharedKey!, 'preview', preview, photo.filename);
        }
        // The full original goes up unchanged (never recompressed). One that cannot be read here keeps its preview and is said.
        if (withOriginals && readOriginal && stored?.get(photo.sharedKey!) !== true) {
          const original = await readOriginal(photo.id);
          if (original && original.size <= CLOUD_ORIGINAL_MAX_BYTES) await client.cloudUpload(linked, photo.sharedKey!, 'original', original, photo.filename);
          else originalsUnread += 1;
        }
        done += 1;
        row.progress(done, toStore.length, t.progress(done, toStore.length));
      }
      const said = [t.stored(done, toStore.length), skipped ? t.skipped(skipped) : '', originalsUnread ? t.originalsUnread(originalsUnread) : ''].filter(Boolean).join(' ');
      row.finish(said);
      setMessage(said);
    } catch (error) {
      // Never a silent failure: how many went up, how many did not, and why.
      const isFull = error instanceof CollabError && error.code === 'STORAGE_NEEDS_CREDIT';
      const said = isFull ? t.storedThenFull(done, toStore.length - done) : `${t.stored(done, toStore.length)} ${error instanceof Error ? error.message : t.problem}`;
      row.fail(said);
      setMessage(said);
      setFull(isFull);
    } finally {
      stop.current = null;
      setBusy(false);
      await load();
      onChanged?.();
    }
  };

  const remove = async () => {
    const linked = localProjectId ? readSharedLink(localProjectId) : null;
    if (!linked || !toRemove.length) return;
    setBusy(true); setMessage(''); setConfirmRemove(false);
    let done = 0;
    try {
      for (const photo of toRemove) { await client.cloudRemove(linked, photo.sharedKey!); done += 1; }
      setMessage(t.removed(done));
    } catch (error) {
      setMessage(`${t.removed(done)} ${error instanceof Error ? error.message : t.problem}`);
    } finally {
      setBusy(false);
      await load();
      onChanged?.();
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="v2-store-cloud-title" data-testid="store-cloud-dialog"
        className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="flex items-center justify-between gap-3">
          <h2 id="v2-store-cloud-title" className="text-base font-semibold">{t.heading}</h2>
          <button ref={closeButton} type="button" disabled={busy} onClick={onClose} className={button}>{t.close}</button>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{readOriginal ? t.introOriginals : t.intro}</p>
        {!withOriginals && <p className="text-sm text-[var(--text-secondary)]" data-testid="store-cloud-preview-only">{t.previewOnly}</p>}

        <fieldset data-testid="store-cloud-filter" className="space-y-1.5" disabled={busy}>
          <legend className="text-xs font-semibold">{t.which}</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {STORE_FILTERS.map((option) => (
              <label key={option} className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-xs ${filter === option
                ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] font-semibold' : 'border-[var(--border-default)] text-[var(--text-secondary)]'} focus-within:outline focus-within:outline-2 focus-within:outline-[var(--brand-accent)]`}>
                <input type="radio" name="store-cloud-filter" value={option} checked={filter === option} onChange={() => change({ filter: option })} className="h-3 w-3" />
                <span>{t.filters[option]}</span>
              </label>
            ))}
            {filter === 'tag' && (
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span>{t.tagLabel}</span>
                <input type="text" value={tag} maxLength={80} placeholder={t.tagPlaceholder} data-testid="store-cloud-tag"
                  onChange={(event) => change({ tag: event.target.value })}
                  className="h-9 w-36 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs" />
              </label>
            )}
            {filter === 'rated' && (
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span>{t.ratedLabel}</span>
                <select value={minRating} data-testid="store-cloud-rated" onChange={(event) => change({ minRating: Number(event.target.value) })}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{t.stars(n)}</option>)}
                </select>
              </label>
            )}
            {filter === 'top' && (
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span>{t.topHowMany}</span>
                <input type="number" min={1} max={5000} value={top} data-testid="store-cloud-top"
                  onChange={(event) => change({ top: Math.max(1, Math.min(5000, Math.floor(Number(event.target.value)) || 1)) })}
                  className="h-9 w-20 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs" />
              </label>
            )}
          </div>
        </fieldset>

        {readOriginal && (
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" data-testid="store-cloud-originals" checked={choice.originals} disabled={busy} onChange={(event) => change({ originals: event.target.checked })} className="h-4 w-4" />
            <span>{t.originalsToo}</span>
          </label>
        )}

        {listFailed ? (
          <p role="alert" data-testid="store-cloud-list-failed" className="text-sm text-[var(--text-secondary)]">{t.listFailed}</p>
        ) : stored === null ? (
          <p role="status" className="text-sm text-[var(--text-secondary)]">{t.checking}</p>
        ) : (
          <div className="space-y-1 text-sm" data-testid="store-cloud-summary">
            <p>{t.summary(toStore.length, toRemove.length)}</p>
            {estimate && toStore.length > 0 && (
              <p data-testid="store-cloud-size" className="text-[var(--text-secondary)]">
                {t.size(formatBytes(estimate.bytes), formatBytes(estimate.included))}
                {estimate.storedNow !== null && <> · {t.usedNow(formatBytes(estimate.storedNow))}</>}
              </p>
            )}
            {toStore.length > 0 && <p data-testid="store-cloud-plain" className="font-semibold">{t.plain(toStore.length, plainSize)}</p>}
            {estimate && toStore.length > 0 && !estimate.fits && <p data-testid="store-cloud-over" className="text-[var(--text-secondary)]">{t.over}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="store-cloud-store" disabled={busy || stored === null || !toStore.length || !renderPreview} aria-busy={busy} onClick={() => { void store(); }} className={primary}>
            {busy ? t.working : t.store(toStore.length)}
          </button>
          {busy && stop.current && <button type="button" onClick={() => stop.current?.abort()} className={button}>{t.stop}</button>}
          {!busy && toRemove.length > 0 && !confirmRemove && (
            <button type="button" data-testid="store-cloud-remove" onClick={() => setConfirmRemove(true)} className={button}>{t.remove(toRemove.length)}</button>
          )}
        </div>
        {confirmRemove && (
          <div role="group" aria-label={t.remove(toRemove.length)} data-testid="store-cloud-remove-confirm" className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
            <p className="text-sm">{t.removeAsk(toRemove.length)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { void remove(); }} className={button}>{t.removeYes}</button>
              <button type="button" onClick={() => setConfirmRemove(false)} className={button}>{t.removeNo}</button>
            </div>
          </div>
        )}
        {message && <p role="status" aria-live="polite" data-testid="store-cloud-message" className="text-sm text-[var(--text-secondary)]">{message}</p>}
        {full && <button type="button" data-testid="store-cloud-top-up" onClick={onTopUp} className={button}>{t.fullTopUp}</button>}
      </section>
    </div>
  );
}
