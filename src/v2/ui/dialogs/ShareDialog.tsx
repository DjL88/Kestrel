import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollabRole } from '../../../core/collabRoles';
import { initialsOf } from '../../../core/editingSequence';
import { CollabError, type CollabClient, type CollabInvite, type CollabProjectView } from '../../../providers/collabClient';
import { STRINGS } from '../strings';
import { galleryThumbnail } from '../../engineClient/galleryThumbnail';
import { MAX_PORTFOLIO_PHOTOS, buildPortfolioHtml, portfolioFileName, type PortfolioPhoto } from '../../../core/portfolioPage';
import { saveExportFile } from '../../../providers/browserExport';
import GalleryFeedbackPanel from './GalleryFeedbackPanel';
import CloudPhotosPanel, { type LocalCloudPhoto } from './CloudPhotosPanel';
import { readSharedLink, writeSharedLink } from './sharedLinks';

interface ShareDialogProps {
  open: boolean;
  client: CollabClient;
  /** This device's project; the shared project it is linked to is remembered per device. */
  localProjectId: string | null;
  projectName: string;
  selectedPhotoIds: string[];
  /** The signed-in person's name, or null when signed out. */
  displayName: () => Promise<string | null>;
  /** A sized JPEG of a photo as it is developed now, or null when it has no developed preview yet. */
  renderPreview?: (photoId: string) => Promise<Blob | null>;
  /** Where the public gallery page lives (`/gallery`); empty when this build cannot make client links. */
  siteUrl: string;
  photoName: (photoId: string) => string;
  /** This project's photos, for the cloud store. */
  localPhotos: LocalCloudPhoto[];
  readOriginal?: (photoId: string) => Promise<Blob | null>;
  importCloud?: (items: { file: File; projectId: string; photoKey: string }[]) => Promise<void>;
  attachOriginal?: (photoId: string, original: File, sha256: string) => Promise<boolean>;
  onGoToPhoto: (photoId: string) => void;
  /** This project's decision for a photo, or null when it is not here. Client feedback offers "Flag it" from it. */
  photoDecision?: (photoId: string) => 'unreviewed' | 'keep' | 'reject' | null;
  /** Flags one photo, only when the photographer chooses a client's pick. */
  onFlagPhoto?: (photoId: string) => void;
  onClose: () => void;
}

const INVITE_ROLES: Exclude<CollabRole, 'owner'>[] = ['editor', 'commenter', 'viewer', 'client'];

/**
 * Share a project with named people (#1387 C01). Opt-in: nothing is contacted until this dialog opens, and a project
 * that is never shared keeps working offline. For now only the project name and the people are shared; the dialog says so.
 */
export default function ShareDialog({ open, client, localProjectId, projectName, selectedPhotoIds, displayName, renderPreview, siteUrl, photoName, onGoToPhoto, localPhotos, readOriginal, importCloud, attachOriginal, photoDecision, onFlagPhoto, onClose }: ShareDialogProps) {
  const t = STRINGS.share;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<CollabProjectView | null>(null);
  const [invites, setInvites] = useState<CollabInvite[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<CollabRole, 'owner'>>('editor');
  const [gallery, setGallery] = useState({ days: 14, password: '', allowComments: true, allowFavourites: true, allowApproval: true, allowDownloads: false, watermark: true });
  const [galleryLink, setGalleryLink] = useState<string | null>(null);
  const [published, setPublished] = useState(0);
  const [portfolio, setPortfolio] = useState({ title: '', byline: '', captions: false });
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioNote, setPortfolioNote] = useState<string | null>(null);

  const explain = useCallback((error: unknown) => {
    const kind = error instanceof CollabError ? error.kind : 'network';
    setProblem(kind === 'not-configured' ? t.notConfigured : kind === 'sign-in' ? t.signIn : kind === 'not-entitled' ? t.notEntitled
      : kind === 'switched-off' ? t.switchedOff : kind === 'refused' && error instanceof CollabError && error.message ? error.message : t.failed);
  }, [t]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true); setProblem(null); setNote(null);
    try { await work(); } catch (error) { explain(error); } finally { setBusy(false); }
  }, [explain]);

  useEffect(() => {
    if (!open) return;
    setView(null); setInvites([]); setProblem(null); setNote(null); setGalleryLink(null); setPortfolioNote(null);
    if (!client.configured) { setProblem(t.notConfigured); return; }
    const linked = localProjectId ? readSharedLink(localProjectId) : null;
    void run(async () => {
      const [mine, waiting] = await Promise.all([linked ? client.project(linked) : Promise.resolve(null), client.invites()]);
      setView(mine); setInvites(waiting);
    });
  }, [open, client, localProjectId, run, t]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); previous?.focus(); };
  }, [open, onClose]);

  if (!open) return null;

  const start = () => run(async () => {
    const name = await displayName();
    if (!name) throw new CollabError('sign-in');
    const id = await client.create(projectName.trim() || 'InFlight project', name);
    if (localProjectId) writeSharedLink(localProjectId, id);
    setView(await client.project(id));
  });
  const invite = () => view && run(async () => {
    const photoIds = role === 'client' ? selectedPhotoIds : undefined;
    setView(await client.invite(view.projectId, email.trim(), role, photoIds));
    setEmail(''); setNote(t.inviteSent);
  });
  const join = (item: CollabInvite) => run(async () => {
    const name = await displayName();
    if (!name) throw new CollabError('sign-in');
    await client.accept(item.projectId, name);
    setInvites((current) => current.filter((entry) => entry.projectId !== item.projectId));
    setView(await client.project(item.projectId));
  });
  const publish = () => view && renderPreview && run(async () => {
    setGalleryLink(null);
    const previews: { photoId: string; jpeg: Blob; thumb: Blob | null }[] = [];
    for (const photoId of selectedPhotoIds) {
      const jpeg = await renderPreview(photoId);
      if (jpeg) previews.push({ photoId, jpeg, thumb: await galleryThumbnail(jpeg) });
    }
    const skipped = selectedPhotoIds.length - previews.length;
    if (!previews.length) { setNote(t.gallerySkipped(skipped)); return; }
    const name = projectName.trim() || 'InFlight project';
    const made = await client.publishGallery(view.projectId, {
      name, photoIds: previews.map((item) => item.photoId), days: gallery.days, ...(gallery.password ? { password: gallery.password } : {}),
      allowComments: gallery.allowComments, allowFavourites: gallery.allowFavourites, allowApproval: gallery.allowApproval,
      allowDownloads: gallery.allowDownloads, watermark: gallery.watermark,
    }, previews);
    setPublished((n) => n + 1);
    setGalleryLink(`${siteUrl.replace(/\/+$/, '')}/gallery#t=${encodeURIComponent(made.linkToken)}`);
    setNote([t.galleryDone(made.published), skipped ? t.gallerySkipped(skipped) : ''].filter(Boolean).join(' '));
  });
  // Offline portfolio: made and saved on this device only. Needs no account, and nothing is sent anywhere.
  const savePortfolio = async () => {
    if (!renderPreview || portfolioBusy || !selectedPhotoIds.length || selectedPhotoIds.length > MAX_PORTFOLIO_PHOTOS) return;
    setPortfolioBusy(true); setPortfolioNote(null);
    try {
      const photos: PortfolioPhoto[] = [];
      for (const photoId of selectedPhotoIds) {
        const jpeg = await renderPreview(photoId);
        if (!jpeg) continue;
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error('Could not read the preview.'));
          reader.readAsDataURL(jpeg.type ? jpeg : new Blob([jpeg], { type: 'image/jpeg' }));
        });
        const size = await createImageBitmap(jpeg).then((bitmap) => { const s = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return s; }, () => ({}));
        photos.push({ image, ...size, ...(portfolio.captions ? { caption: photoName(photoId) } : {}) });
      }
      const skipped = selectedPhotoIds.length - photos.length;
      if (!photos.length) { setPortfolioNote(t.gallerySkipped(skipped)); return; }
      const title = portfolio.title.trim() || projectName.trim() || 'Portfolio';
      const html = buildPortfolioHtml({ title, byline: portfolio.byline, lang: document.documentElement.lang || 'en-GB', photos,
        labels: { photo: t.portfolioPhoto, footer: t.portfolioFooter } });
      const saved = await saveExportFile(new Blob([html], { type: 'text/html' }), portfolioFileName(title), new AbortController().signal);
      if (saved) setPortfolioNote([t.portfolioSaved(photos.length), skipped ? t.gallerySkipped(skipped) : ''].filter(Boolean).join(' '));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setPortfolioNote(t.portfolioFailed);
    } finally { setPortfolioBusy(false); }
  };
  const copyLink = () => { if (galleryLink) void navigator.clipboard?.writeText(galleryLink).then(() => setNote(t.galleryCopied), () => undefined); };
  const toggles = [['allowComments', t.galleryComments], ['allowFavourites', t.galleryFavourites], ['allowApproval', t.galleryApproval],
    ['allowDownloads', t.galleryDownloads], ['watermark', t.galleryWatermark]] as const;
  const manages = view?.me.role === 'owner';
  const canInvite = view && (view.me.role === 'owner' || view.me.role === 'editor');
  const inputClass = 'min-h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 text-sm';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-share-title" data-testid="share-dialog"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="v2-share-title" className="text-base font-semibold">{t.heading}</h2>
          <button ref={closeButton} type="button" onClick={onClose} className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{t.close}</button>
        </div>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">{t.intro}</p>
        {problem && <p role="alert" className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2.5 text-sm">{problem}</p>}
        {note && <p role="status" className="mb-3 text-sm text-[var(--text-secondary)]">{note}</p>}

        {renderPreview && (
          <form className="mb-4 space-y-2 border-b border-[var(--border-default)] pb-3" data-testid="share-portfolio" onSubmit={(event) => { event.preventDefault(); void savePortfolio(); }}>
            <h3 className="text-xs font-semibold">{t.portfolioHeading}</h3>
            <p className="text-xs text-[var(--text-secondary)]">{t.portfolioIntro}</p>
            {selectedPhotoIds.length === 0 && <p className="text-xs">{t.galleryNeedsPhotos}</p>}
            {selectedPhotoIds.length > MAX_PORTFOLIO_PHOTOS && <p className="text-xs">{t.portfolioTooMany(MAX_PORTFOLIO_PHOTOS)}</p>}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">{t.portfolioTitle}
                <input value={portfolio.title} placeholder={projectName} maxLength={120} onChange={(event) => setPortfolio((p) => ({ ...p, title: event.target.value }))} className={inputClass} />
              </label>
              <label className="block text-xs">{t.portfolioByline}
                <input value={portfolio.byline} maxLength={120} onChange={(event) => setPortfolio((p) => ({ ...p, byline: event.target.value }))} className={inputClass} autoComplete="name" />
              </label>
            </div>
            <label className="flex min-h-8 items-center gap-2 text-xs">
              <input type="checkbox" checked={portfolio.captions} onChange={(event) => setPortfolio((p) => ({ ...p, captions: event.target.checked }))} />{t.portfolioCaptions}
            </label>
            <button type="submit" disabled={portfolioBusy || selectedPhotoIds.length === 0 || selectedPhotoIds.length > MAX_PORTFOLIO_PHOTOS}
              className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium disabled:opacity-50">{t.portfolioSave(selectedPhotoIds.length)}</button>
            {portfolioNote && <p role="status" data-testid="share-portfolio-note" className="text-xs text-[var(--text-secondary)]">{portfolioNote}</p>}
          </form>
        )}

        {invites.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-1.5 text-xs font-semibold">{t.yourInvites}</h3>
            <ul className="space-y-1 text-sm">
              {invites.map((item) => (
                <li key={item.projectId} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5">
                  <span className="min-w-0 truncate">{item.name} · {t.roles[item.role]}</span>
                  <button type="button" disabled={busy} onClick={() => join(item)} className="min-h-9 shrink-0 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)]">{t.join}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!view && client.configured && (
          <button type="button" disabled={busy} onClick={start}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] disabled:opacity-50">{t.start}</button>
        )}

        {view && (
          <>
            <h3 className="mb-1.5 text-xs font-semibold">{t.people}</h3>
            <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto text-sm">
              {view.members.map((member) => (
                <li key={member.accountId} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5">
                  <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] text-[10px] font-semibold">{initialsOf(member.displayName)}</span>
                  <span className="min-w-0 flex-1 truncate">{member.displayName}{member.accountId === view.me.accountId ? ` (${t.you})` : ''}</span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">{t.roles[member.role]}</span>
                </li>
              ))}
              {view.invites.map((pending, index) => (
                <li key={`invite-${index}`} className="flex items-center gap-2 px-2.5 py-1 text-[var(--text-secondary)]">
                  <span className="min-w-0 flex-1 truncate">{pending.displayName || t.invited}</span>
                  <span className="shrink-0 text-xs">{t.invited} · {t.roles[pending.role]}</span>
                </li>
              ))}
            </ul>
            {canInvite && (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
                <h3 className="text-xs font-semibold">{t.inviteHeading}</h3>
                <label className="block text-xs">{t.email}
                  <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} autoComplete="off" />
                </label>
                <label className="block text-xs">{t.role}
                  <select value={role} onChange={(event) => setRole(event.target.value as Exclude<CollabRole, 'owner'>)} className={inputClass}>
                    {INVITE_ROLES.filter((option) => manages || option !== 'editor').map((option) => <option key={option} value={option}>{t.roles[option]}</option>)}
                  </select>
                </label>
                {role === 'client' && <p className="text-xs text-[var(--text-secondary)]">{t.clientHint}</p>}
                <button type="submit" disabled={busy || !email.trim() || (role === 'client' && selectedPhotoIds.length === 0)}
                  className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium disabled:opacity-50">{t.sendInvite}</button>
              </form>
            )}
            {canInvite && renderPreview && siteUrl && (
              <form className="mt-4 space-y-2 border-t border-[var(--border-default)] pt-3" data-testid="share-gallery" onSubmit={(event) => { event.preventDefault(); void publish(); }}>
                <h3 className="text-xs font-semibold">{t.galleryHeading}</h3>
                <p className="text-xs text-[var(--text-secondary)]">{t.galleryIntro}</p>
                {selectedPhotoIds.length === 0 && <p className="text-xs">{t.galleryNeedsPhotos}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs">{t.galleryDays}
                    <input type="number" min={1} max={90} value={gallery.days} onChange={(event) => setGallery((g) => ({ ...g, days: Math.min(90, Math.max(1, Math.round(Number(event.target.value) || 1))) }))} className={inputClass} />
                  </label>
                  <label className="block text-xs">{t.galleryPassword}
                    <input type="password" value={gallery.password} minLength={6} maxLength={200} onChange={(event) => setGallery((g) => ({ ...g, password: event.target.value }))} className={inputClass} autoComplete="new-password" />
                  </label>
                </div>
                <div className="space-y-1">
                  {toggles.map(([key, label]) => (
                    <label key={key} className="flex min-h-8 items-center gap-2 text-xs">
                      <input type="checkbox" checked={gallery[key]} onChange={(event) => setGallery((g) => ({ ...g, [key]: event.target.checked }))} />{label}
                    </label>
                  ))}
                </div>
                <button type="submit" disabled={busy || selectedPhotoIds.length === 0}
                  className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium disabled:opacity-50">{t.galleryPublish(selectedPhotoIds.length)}</button>
                {galleryLink && (
                  <div className="space-y-1">
                    <label className="block text-xs">{t.galleryLink}
                      <input readOnly value={galleryLink} data-testid="share-gallery-link" onFocus={(event) => event.currentTarget.select()} className={inputClass} />
                    </label>
                    <button type="button" onClick={copyLink} className="min-h-9 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)]">{t.galleryCopy}</button>
                  </div>
                )}
              </form>
            )}
            <CloudPhotosPanel client={client} projectId={view.projectId} role={view.me.role} photos={localPhotos} selectedPhotoIds={selectedPhotoIds}
              renderPreview={renderPreview} readOriginal={readOriginal} importCloud={importCloud} attachOriginal={attachOriginal} onProblem={explain} />
            {canInvite && <GalleryFeedbackPanel client={client} projectId={view.projectId} version={published} photoName={photoName} onGoToPhoto={onGoToPhoto} onProblem={explain} photoDecision={photoDecision} onFlag={onFlagPhoto} />}
          </>
        )}
      </section>
    </div>
  );
}
