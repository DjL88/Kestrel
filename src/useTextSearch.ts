import { useEffect, useRef, useState } from 'react';
import { encodeVector, isSearchable, normaliseQuery, rankByQuery, readVector, type Scored, type SearchState, type StoredVector } from './core/textSearch';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { pictureForAnalysis } from './providers/pictureForAnalysis';
import { embedPicture } from './providers/categoryGate';
import { downloadTextModel, embedQuery, textSearchStatus, type TextSearchStatus } from './providers/textSearch';

interface Options {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  query: string;
  /** Saves a photo's vector with the project. */
  onVector: (frameId: string, vector: StoredVector) => void;
}

/** Search by description. Photos are embedded once, only when someone searches, and never block the words search. */
export function useTextSearch({ frames, provider, query, onVector }: Options) {
  const [status, setStatus] = useState<TextSearchStatus>('words-only');
  const [ranked, setRanked] = useState<Scored[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [download, setDownload] = useState<number | null>(null);
  const latest = useRef({ frames, provider, onVector });
  latest.current = { frames, provider, onVector };
  const text = normaliseQuery(query);
  const searchable = isSearchable(text);
  const failed = useRef(new Set<string>());

  useEffect(() => { if (searchable) void textSearchStatus().then(setStatus); }, [searchable]);

  // Vectors of photos not yet embedded, for this project, one at a time.
  const missing = frames.filter((f) => !f.removedAt && !readVector(f.searchVector) && !failed.current.has(f.id)).length;
  useEffect(() => {
    if (!searchable || status !== 'ready' || !missing) return;
    let cancelled = false;
    void (async () => {
      const total = latest.current.frames.filter((f) => !f.removedAt).length;
      for (const frame of latest.current.frames) {
        if (cancelled) return;
        if (frame.removedAt || readVector(frame.searchVector) || failed.current.has(frame.id) || !latest.current.provider) continue;
        try {
          const picture = await pictureForAnalysis(latest.current.provider, frame);
          if (!picture) { failed.current.add(frame.id); continue; }
          latest.current.onVector(frame.id, encodeVector(await embedPicture(picture)));
          setProgress({ done: total - latest.current.frames.filter((f) => !f.removedAt && !readVector(f.searchVector)).length, total });
        } catch { failed.current.add(frame.id); }
      }
    })();
    return () => { cancelled = true; };
  }, [searchable, status, missing === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rank whenever the words or the stored vectors change. Any failure leaves the plain-words results.
  useEffect(() => {
    if (!searchable || status !== 'ready') { setRanked([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      embedQuery(text).then((vector) => {
        if (cancelled) return;
        setRanked(rankByQuery(vector, frames.map((f) => ({ id: f.id, vector: readVector(f.searchVector) }))));
      }).catch(() => { if (!cancelled) { setRanked([]); setStatus('words-only'); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, searchable, status, frames]);

  async function startDownload() {
    try { setDownload(0); await downloadTextModel(setDownload); setStatus('ready'); } catch { /* stays words-only; shown quietly */ } finally { setDownload(null); }
  }

  const state: SearchState = !searchable ? 'ready' : status === 'not-downloaded' ? 'offer-download'
    : status === 'ready' ? (missing ? 'preparing' : 'ready') : 'words-only';
  return { ranked, state, progress: { done: progress.done, total: progress.total || frames.length }, download, startDownload };
}
