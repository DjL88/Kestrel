import { useCallback, useEffect, useState } from 'react';
import { summariseGalleryFeedback, type GallerySummary } from '../../../core/galleryFeedback';
import type { CollabClient, GalleryListItem } from '../../../providers/collabClient';
import { STRINGS } from '../strings';

interface GalleryFeedbackPanelProps {
  client: CollabClient;
  projectId: string;
  /** Bumped after a gallery is published, so the list reloads. */
  version: number;
  photoName: (photoId: string) => string;
  onGoToPhoto: (photoId: string) => void;
  onProblem: (error: unknown) => void;
}

/** The photographer's view of client galleries: what each client favoured, approved or asked to change (#1387 C07). */
export default function GalleryFeedbackPanel({ client, projectId, version, photoName, onGoToPhoto, onProblem }: GalleryFeedbackPanelProps) {
  const t = STRINGS.share;
  const [galleries, setGalleries] = useState<GalleryListItem[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, GallerySummary>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const list = await client.galleries(projectId);
      const entries = await Promise.all(list.map(async (g) => [g.galleryId, summariseGalleryFeedback(await client.galleryFeedback(g.galleryId), g.photoIds ?? [])] as const));
      setGalleries(list); setSummaries(Object.fromEntries(entries));
    } catch (error) { onProblem(error); } finally { setBusy(false); }
  }, [client, projectId, onProblem]);

  useEffect(() => { void load(); }, [load, version]);

  const revoke = async (galleryId: string) => {
    setBusy(true);
    try { await client.revokeGallery(galleryId); setGalleries((list) => list?.filter((g) => g.galleryId !== galleryId) ?? null); }
    catch (error) { onProblem(error); } finally { setBusy(false); }
  };

  if (!galleries) return null;
  return (
    <div className="mt-4 border-t border-[var(--border-default)] pt-3" data-testid="share-gallery-feedback">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">{t.feedbackHeading}</h3>
        <button type="button" disabled={busy} onClick={() => void load()} className="min-h-9 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)] disabled:opacity-50">{t.feedbackRefresh}</button>
      </div>
      {galleries.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{t.feedbackNone}</p>}
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {galleries.map((g) => {
          const s = summaries[g.galleryId];
          const withFeedback = s?.photos.filter((p) => p.favourites || p.approvals || p.changeRequests || p.notes.length) ?? [];
          return (
            <li key={g.galleryId} className="rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] p-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="text-[var(--text-secondary)]">{t.feedbackEnds(new Date(g.expiresAtMs).toLocaleDateString())} · {t.feedbackPhotos(g.published)}</p>
                  {s && <p>{t.feedbackTotals(s.total.favourites, s.total.approvals, s.total.changeRequests, s.total.notes)}</p>}
                </div>
                <button type="button" disabled={busy} onClick={() => void revoke(g.galleryId)} className="min-h-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 font-medium disabled:opacity-50">{t.feedbackRevoke}</button>
              </div>
              {withFeedback.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer">{t.feedbackDetails}</summary>
                  <ul className="mt-1 space-y-1.5">
                    {withFeedback.map((p) => (
                      <li key={p.photoId}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{photoName(p.photoId)}</span>
                          <button type="button" onClick={() => onGoToPhoto(p.photoId)} className="min-h-8 shrink-0 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-surface-active)]">{t.feedbackShow}</button>
                        </div>
                        <p className="text-[var(--text-secondary)]">{t.feedbackTotals(p.favourites, p.approvals, p.changeRequests, p.notes.length)}</p>
                        {p.notes.map((n, i) => <p key={i} className="whitespace-pre-wrap">{n.kind === 'request-changes' ? `${t.feedbackChangesLabel}: ` : ''}{n.text}</p>)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
