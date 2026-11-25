import { useEffect, useRef, useState } from 'react';
import type { CollabClient } from '../../../providers/collabClient';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import { creditsFor, dontAskAgain, fetchCloudOriginal, setDontAskAgain } from './cloudOriginals';
import { readSharedLink } from './sharedLinks';

interface CloudOriginalPromptProps {
  client: CollabClient;
  localProjectId: string | null;
  /** The photo whose cloud preview was just zoomed past 100%, or null. */
  photo: Photo | null;
  attachOriginal?: (photoId: string, original: File, sha256: string) => Promise<boolean>;
  onDone: () => void;
}

type View =
  | { kind: 'idle' }
  | { kind: 'ask'; photoKey: string; project: string; bytes: number; name: string }
  | { kind: 'working' }
  | { kind: 'none' }
  | { kind: 'failed' };

/**
 * Zooming past 100% on a cloud preview (#1387): the original is fetched only with the person's say-so. The credit cost
 * is shown once, with "Don't ask again" for this device; after that the original comes down on its own. Each photo is
 * asked about once per session, and an original the owner never stored is said plainly rather than pretended.
 */
export default function CloudOriginalPrompt({ client, localProjectId, photo, attachOriginal, onDone }: CloudOriginalPromptProps) {
  const t = STRINGS.share;
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [skip, setSkip] = useState(false);
  const asked = useRef(new Set<string>());

  const fetchNow = async (photoId: string, project: string, photoKey: string, name: string) => {
    setView({ kind: 'working' });
    try {
      const { file, sha256 } = await fetchCloudOriginal(client, project, photoKey, name);
      await attachOriginal?.(photoId, file, sha256);
      setView({ kind: 'idle' });
      onDone();
    } catch { setView({ kind: 'failed' }); }
  };

  useEffect(() => {
    if (!photo?.cloudPreview || !photo.sharedKey || !attachOriginal || !localProjectId || asked.current.has(photo.id)) return;
    const project = readSharedLink(localProjectId);
    if (!project || !client.configured) return;
    asked.current.add(photo.id);
    const photoKey = photo.sharedKey;
    let live = true;
    void client.cloudPhotos(project).then((list) => {
      if (!live) return;
      const stored = list.find((item) => item.photoKey === photoKey);
      if (!stored?.originalBytes) { setView({ kind: 'none' }); return; }
      if (dontAskAgain()) void fetchNow(photo.id, project, photoKey, stored.name);
      else setView({ kind: 'ask', photoKey, project, bytes: stored.originalBytes, name: stored.name });
    }).catch(() => { if (live) setView({ kind: 'failed' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, photo?.cloudPreview, photo?.sharedKey, localProjectId, client, attachOriginal]);

  if (view.kind === 'idle' || !photo) return null;
  const close = () => { setView({ kind: 'idle' }); onDone(); };
  const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium';

  return (
    <div
      role={view.kind === 'ask' ? 'dialog' : 'status'}
      aria-label={t.cloudHeading}
      data-testid="cloud-original-prompt"
      className="fixed bottom-20 left-1/2 z-40 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-sm shadow-lg"
    >
      {view.kind === 'ask' && (
        <>
          <p>{t.zoomOriginalAsk(creditsFor(view.bytes))}</p>
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} />{t.zoomOriginalDontAsk}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => { setDontAskAgain(skip); void fetchNow(photo.id, view.project, view.photoKey, view.name); }}>{t.zoomOriginalDownload}</button>
            <button type="button" className={button} onClick={close}>{t.zoomOriginalNotNow}</button>
          </div>
        </>
      )}
      {view.kind === 'working' && <p>{t.zoomOriginalWorking}</p>}
      {(view.kind === 'none' || view.kind === 'failed') && (
        <div className="flex items-start gap-2">
          <p className="flex-1">{view.kind === 'none' ? t.zoomOriginalNone : t.zoomOriginalFailed}</p>
          <button type="button" className={button} onClick={close}>{t.zoomOriginalClose}</button>
        </div>
      )}
    </div>
  );
}
