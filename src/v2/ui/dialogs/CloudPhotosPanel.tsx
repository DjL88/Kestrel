import { useCallback, useEffect, useState } from 'react';
import { PAYG_PENCE } from '../../../core/cloudPlan';
import type { CollabRole } from '../../../core/collabRoles';
import type { CloudPhotoView, CloudUsage, CollabClient } from '../../../providers/collabClient';
import { galleryThumbnail } from '../../engineClient/galleryThumbnail';
import { STRINGS } from '../strings';

export interface LocalCloudPhoto { id: string; sharedKey?: string; filename: string; cloudPreview?: boolean }

interface CloudPhotosPanelProps {
  client: CollabClient;
  projectId: string;
  role: CollabRole;
  photos: LocalCloudPhoto[];
  selectedPhotoIds: string[];
  renderPreview?: (photoId: string) => Promise<Blob | null>;
  readOriginal?: (photoId: string) => Promise<Blob | null>;
  importCloud?: (items: { file: File; projectId: string; photoKey: string }[]) => Promise<void>;
  onProblem: (error: unknown) => void;
}

/** Credits per GB downloaded (1 credit = 1p), from the shared price list. Shown before anything is fetched, so nobody is surprised. */
const creditsFor = (bytes: number) => Math.ceil(bytes * PAYG_PENCE.downloadPerGb / 1e9 * 10) / 10;
const ORIGINALS_CACHE = 'inflight-cloud-originals-v1';

/**
 * A shared project's photos in the cloud (#1387). Owners and editors put sized previews up (and originals, only if they
 * choose); everyone else adds the previews to their own device once, and fetches an original only when they ask for it.
 * Downloads come out of the owner's monthly allowance, and the cost is shown before each one.
 */
export default function CloudPhotosPanel({ client, projectId, role, photos, selectedPhotoIds, renderPreview, readOriginal, importCloud, onProblem }: CloudPhotosPanelProps) {
  const t = STRINGS.share;
  const [cloud, setCloud] = useState<CloudPhotoView[] | null>(null);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [withOriginals, setWithOriginals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const editor = role === 'owner' || role === 'editor';

  const load = useCallback(async () => {
    try {
      const [list, used] = await Promise.all([client.cloudPhotos(projectId), client.usage().catch(() => null)]);
      setCloud(list); setUsage(used);
    } catch (error) { onProblem(error); }
  }, [client, projectId, onProblem]);
  useEffect(() => { void load(); }, [load]);

  if (role === 'client' || !cloud) return null;
  const inCloud = new Map(cloud.map((photo) => [photo.photoKey, photo]));
  const here = new Set(photos.map((photo) => photo.sharedKey).filter(Boolean));
  const toUpload = photos.filter((photo) => photo.sharedKey && !photo.cloudPreview && (!inCloud.has(photo.sharedKey) || (withOriginals && inCloud.get(photo.sharedKey)!.originalBytes === null)));
  const missing = cloud.filter((photo) => !here.has(photo.photoKey));
  const originals = photos.filter((photo) => selectedPhotoIds.includes(photo.id) && photo.cloudPreview && photo.sharedKey && inCloud.get(photo.sharedKey)?.originalBytes);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (error) { onProblem(error); } finally { setBusy(false); setProgress(null); await load(); }
  };

  const upload = () => run(async () => {
    let done = 0;
    for (const photo of toUpload) {
      setProgress(t.cloudProgress(done, toUpload.length));
      const key = photo.sharedKey!;
      if (!inCloud.has(key) && renderPreview) {
        const preview = await renderPreview(photo.id);
        if (preview) {
          const thumb = await galleryThumbnail(preview);
          if (thumb) await client.cloudUpload(projectId, key, 'thumb', thumb, photo.filename);
          await client.cloudUpload(projectId, key, 'preview', preview, photo.filename);
        }
      }
      if (withOriginals && readOriginal) {
        const original = await readOriginal(photo.id);
        if (original) await client.cloudUpload(projectId, key, 'original', original, photo.filename);
      }
      done += 1;
    }
  });

  const addToDevice = () => importCloud && run(async () => {
    const items: { file: File; projectId: string; photoKey: string }[] = [];
    for (const [index, photo] of missing.entries()) {
      setProgress(t.cloudProgress(index, missing.length));
      const blob = await client.cloudDownload(projectId, photo.photoKey, 'preview');
      const stem = photo.name.replace(/\.[^.]+$/, '');
      items.push({ file: new File([blob], `${stem} (${t.cloudPreviewTag}).jpg`, { type: 'image/jpeg', lastModified: 0 }), projectId, photoKey: photo.photoKey });
    }
    if (items.length) await importCloud(items);
  });

  const downloadOriginals = () => run(async () => {
    const cache = typeof caches !== 'undefined' ? await caches.open(ORIGINALS_CACHE).catch(() => null) : null;
    for (const photo of originals) {
      const key = photo.sharedKey!;
      const request = new Request(`https://inflight.invalid/originals/${projectId}/${key}`);
      // Each device downloads an original once: later requests come from this device's own cache.
      let blob = cache ? await (await cache.match(request))?.blob() : undefined;
      if (!blob) {
        blob = await client.cloudDownload(projectId, key, 'original');
        await cache?.put(request, new Response(blob)).catch(() => undefined);
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = inCloud.get(key)?.name ?? `${key}.original`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
  });

  const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium disabled:opacity-50';
  return (
    <div className="mt-4 space-y-2 border-t border-[var(--border-default)] pt-3 text-xs" data-testid="share-cloud">
      <h3 className="font-semibold">{t.cloudHeading}</h3>
      <p className="text-[var(--text-secondary)]">{t.cloudIntro}</p>
      <p>{t.cloudCount(cloud.length)}</p>
      {usage && <p data-testid="share-cloud-usage">{t.cloudUsage(usage.usedCredits, usage.allowanceCredits)}</p>}
      {progress && <p role="status">{progress}</p>}
      {editor && (
        <>
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={withOriginals} onChange={(event) => setWithOriginals(event.target.checked)} />{t.cloudWithOriginals}
          </label>
          <button type="button" disabled={busy || toUpload.length === 0} onClick={() => void upload()} className={button}>{t.cloudUpload(toUpload.length)}</button>
        </>
      )}
      {missing.length > 0 && importCloud && (
        <button type="button" disabled={busy} onClick={() => void addToDevice()} className={button}>
          {t.cloudAdd(missing.length, creditsFor(missing.reduce((sum, photo) => sum + photo.previewBytes, 0)))}
        </button>
      )}
      {editor && originals.length > 0 && (
        <button type="button" disabled={busy} onClick={() => void downloadOriginals()} className={button}>
          {t.cloudOriginals(originals.length, creditsFor(originals.reduce((sum, photo) => sum + (inCloud.get(photo.sharedKey!)?.originalBytes ?? 0), 0)))}
        </button>
      )}
    </div>
  );
}
