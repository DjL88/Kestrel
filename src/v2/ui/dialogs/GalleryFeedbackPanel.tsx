import { useCallback, useEffect, useState } from 'react';
import { summariseGalleryFeedback, type GallerySummary } from '../../../core/galleryFeedback';
import { flagFor, lastActivity, reviewOrder, reviewState, type FeedbackReview, type ReviewState } from '../../../core/clientFeedback';
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
  /** This project's decision for a photo, or null when it is not in this project on this device. */
  photoDecision?: (photoId: string) => 'unreviewed' | 'keep' | 'reject' | null;
  /** Flags one photo. Called only when the photographer chooses "Flag it": client feedback is never applied by itself. */
  onFlag?: (photoId: string) => void;
}

/**
 * The photographer's view of client galleries: what each client favoured, approved or asked to change (#1387 C07), as
 * items to review. Each photo's feedback is new until marked done or dismissed, and new again when a client acts after
 * that. Nothing changes in the project until the photographer chooses: "Flag it" is the only action that sets a decision.
 */
export default function GalleryFeedbackPanel({ client, projectId, version, photoName, onGoToPhoto, onProblem, photoDecision, onFlag }: GalleryFeedbackPanelProps) {
  const t = STRINGS.share;
  const [galleries, setGalleries] = useState<GalleryListItem[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, GallerySummary & { last: Map<string, number>; reviews: FeedbackReview[] }>>({});
  const [note, setNote] = useState<string | null>(null);
  // A gallery with new feedback opens by itself once; after that it stays as the person leaves it, so it never closes under them.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const list = await client.galleries(projectId);
      const entries = await Promise.all(list.map(async (g) => {
        const { events, reviews } = await client.galleryFeedbackWithReviews(g.galleryId);
        return [g.galleryId, { ...summariseGalleryFeedback(events, g.photoIds ?? []), last: lastActivity(events, g.photoIds ?? []), reviews }] as const;
      }));
      setGalleries(list); setSummaries(Object.fromEntries(entries));
      const withNew = entries.filter(([, s]) => s.photos.some((p) => reviewState(p.photoId, s.last, s.reviews).state === 'new' && (p.favourites || p.approvals || p.changeRequests || p.notes.length)));
      setExpanded((current) => ({ ...Object.fromEntries(withNew.map(([id]) => [id, true])), ...current }));
    } catch (error) { onProblem(error); } finally { setBusy(false); }
  }, [client, projectId, onProblem]);

  useEffect(() => { void load(); }, [load, version]);

  const revoke = async (galleryId: string) => {
    setBusy(true);
    try { await client.revokeGallery(galleryId); setGalleries((list) => list?.filter((g) => g.galleryId !== galleryId) ?? null); }
    catch (error) { onProblem(error); } finally { setBusy(false); }
  };

  const review = async (galleryId: string, photoId: string, state: ReviewState) => {
    setBusy(true); setNote(null);
    try { await client.reviewFeedback(galleryId, photoId, state); await load(); } catch (error) { onProblem(error); } finally { setBusy(false); }
  };
  const flag = async (galleryId: string, photoId: string) => {
    onFlag?.(photoId);
    await review(galleryId, photoId, 'done');
    setNote(t.feedbackFlagged);
  };

  if (!galleries) return null;
  return (
    <div className="mt-4 border-t border-[var(--border-default)] pt-3" data-testid="share-gallery-feedback">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">{t.feedbackHeading}</h3>
        <button type="button" disabled={busy} onClick={() => void load()} className="min-h-9 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)] disabled:opacity-50">{t.feedbackRefresh}</button>
      </div>
      {galleries.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{t.feedbackNone}</p>}
      {galleries.length > 0 && <p className="mb-1.5 text-xs text-[var(--text-secondary)]">{t.feedbackNeverApplied}</p>}
      {note && <p role="status" className="mb-1.5 text-xs">{note}</p>}
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {galleries.map((g) => {
          const s = summaries[g.galleryId];
          const withFeedback = reviewOrder((s?.photos.filter((p) => p.favourites || p.approvals || p.changeRequests || p.notes.length) ?? [])
            .map((p) => ({ ...p, ...reviewState(p.photoId, s!.last, s!.reviews) })));
          const fresh = withFeedback.filter((p) => p.state === 'new').length;
          return (
            <li key={g.galleryId} className="rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] p-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}{fresh > 0 && <span className="ml-1 font-semibold">· {t.feedbackNew(fresh)}</span>}</p>
                  <p className="text-[var(--text-secondary)]">{t.feedbackEnds(new Date(g.expiresAtMs).toLocaleDateString())} · {t.feedbackPhotos(g.published)}</p>
                  {s && <p>{t.feedbackTotals(s.total.favourites, s.total.approvals, s.total.changeRequests, s.total.notes)}</p>}
                </div>
                <button type="button" disabled={busy} onClick={() => void revoke(g.galleryId)} className="min-h-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 font-medium disabled:opacity-50">{t.feedbackRevoke}</button>
              </div>
              {withFeedback.length > 0 && (
                <details className="mt-1.5" open={expanded[g.galleryId] ?? false} onToggle={(event) => { const isOpen = event.currentTarget.open; setExpanded((current) => ({ ...current, [g.galleryId]: isOpen })); }}>
                  <summary className="cursor-pointer">{t.feedbackDetails}</summary>
                  <ul className="mt-1 space-y-1.5">
                    {withFeedback.map((p) => {
                      const canFlag = Boolean(onFlag && photoDecision && flagFor(p, photoDecision));
                      return (
                      <li key={p.photoId} data-testid="client-feedback-item" data-state={p.state} className={p.state === 'new' ? '' : 'text-[var(--text-secondary)]'}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{p.state === 'new' ? <span aria-hidden="true">● </span> : null}{photoName(p.photoId)}{p.state === 'new' && <span className="sr-only">, {t.feedbackNewOne}</span>}</span>
                          <button type="button" onClick={() => onGoToPhoto(p.photoId)} className="min-h-8 shrink-0 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-surface-active)]">{t.feedbackShow}</button>
                        </div>
                        <p className="text-[var(--text-secondary)]">{t.feedbackTotals(p.favourites, p.approvals, p.changeRequests, p.notes.length)}</p>
                        {p.notes.map((n, i) => <p key={i} className="whitespace-pre-wrap">{n.kind === 'request-changes' ? `${t.feedbackChangesLabel}: ` : ''}{n.text}</p>)}
                        {p.state === 'new' ? (
                          <div className="mt-1 flex flex-wrap justify-end gap-1">
                            {canFlag && <button type="button" disabled={busy} onClick={() => void flag(g.galleryId, p.photoId)} className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 font-semibold hover:bg-[var(--bg-surface-active)] disabled:opacity-50">⚑ {t.feedbackFlag}</button>}
                            <button type="button" disabled={busy} onClick={() => void review(g.galleryId, p.photoId, 'done')} className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 hover:bg-[var(--bg-surface-active)] disabled:opacity-50">✓ {t.feedbackDone}</button>
                            <button type="button" disabled={busy} onClick={() => void review(g.galleryId, p.photoId, 'dismissed')} className="min-h-8 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-surface-active)] disabled:opacity-50">{t.feedbackDismiss}</button>
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center justify-end gap-2">
                            <span>{p.state === 'done' ? `✓ ${t.feedbackDoneBy(p.byName ?? '')}` : `✕ ${t.feedbackDismissedBy(p.byName ?? '')}`}</span>
                            <button type="button" disabled={busy} onClick={() => void review(g.galleryId, p.photoId, 'new')} className="min-h-8 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-surface-active)] disabled:opacity-50">{t.feedbackAgain}</button>
                          </div>
                        )}
                      </li>
                      );
                    })}
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
