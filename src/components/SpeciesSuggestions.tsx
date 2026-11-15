import { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { SPECIES_MODEL, megabytes } from '../core/speciesModel';
import { confidenceWord, kindFor, personalBonus, pickSuggestions, rankSpecies, recordAccepted, type SpeciesCounts, type Suggestion } from '../core/speciesMatch';
import type { SubjectKind } from '../core/subjectTags';
import { downloadSpeciesModel, embedPicture, loadSpeciesLabels, speciesStatus, type SpeciesStatus } from '../providers/speciesModel';

const COUNTS_KEY = 'kestrel.speciesCounts.v1';
const readCounts = (): SpeciesCounts => { try { return JSON.parse(localStorage.getItem(COUNTS_KEY) ?? '{}') as SpeciesCounts; } catch { return {}; } };

interface Props {
  frameId: string;
  /** A picture of the photo to look at, or null while it is not ready. */
  getPicture: () => HTMLCanvasElement | null;
  ready: boolean;
  tags: string[];
  kind: SubjectKind | undefined;
  /** Add this name as a tag, and set the kind when none is chosen yet. */
  onAccept: (name: string, kind: SubjectKind | undefined) => void;
}

/**
 * Suggests what a photo shows, using a model that runs on this device once it has been downloaded. Every suggestion is
 * a chip to accept or dismiss. Nothing is added until the user taps it, and nothing leaves the device.
 */
export function SpeciesSuggestions({ frameId, getPicture, ready, tags, kind, onAccept }: Props) {
  const [status, setStatus] = useState<SpeciesStatus | 'checking'>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const run = useRef(0);

  useEffect(() => { void speciesStatus().then(setStatus); return () => abort.current?.abort(); }, []);

  async function analyse() {
    const picture = getPicture();
    if (!picture) return;
    const mine = ++run.current;
    setBusy(true);
    setError('');
    try {
      const [{ labels, vectors }, embedding] = await Promise.all([loadSpeciesLabels(), embedPicture(picture)]);
      if (mine !== run.current) return;
      setResults(pickSuggestions(rankSpecies(embedding, labels, vectors, personalBonus(labels, readCounts()))));
      setDismissed([]);
    } catch (reason) {
      if (mine === run.current) setError(reason instanceof Error ? reason.message : 'Could not look at this photo.');
    } finally {
      if (mine === run.current) setBusy(false);
    }
  }

  // Look at each photo once, when it is ready and the model is on this device.
  useEffect(() => {
    setResults(null);
    setDismissed([]);
    if (status === 'ready' && ready) void analyse();
    return () => { run.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId, status, ready]);

  async function download() {
    abort.current = new AbortController();
    setProgress(0);
    setError('');
    try {
      await downloadSpeciesModel(setProgress, abort.current.signal);
      setStatus('ready');
    } catch (reason) {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'The download failed.');
    } finally {
      setProgress(null);
    }
  }

  if (status === 'checking' || status === 'unavailable') return null;

  if (status === 'not-downloaded') {
    return (
      <section aria-label="Species suggestions" className="space-y-2 px-1 pb-2">
        <h3 className="text-sm font-medium text-zinc-100">Suggest what is in your photos</h3>
        <p className="text-xs text-zinc-400">Turn on suggestions for birds and animals. It is a {megabytes(SPECIES_MODEL.bytes)} download, then it works offline and your photos never leave this device.</p>
        {progress === null ? (
          <button type="button" onClick={() => void download()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/15 px-3 text-sm font-medium hover:bg-white/10">
            <Download className="h-4 w-4" aria-hidden="true" />Download ({megabytes(SPECIES_MODEL.bytes)})
          </button>
        ) : (
          <div className="space-y-1">
            <progress aria-label="Downloading species suggestions" className="block w-full" value={progress} max={1} />
            <button type="button" onClick={() => abort.current?.abort()} className="min-h-10 text-xs text-zinc-300 underline underline-offset-4 hover:text-white">Cancel download</button>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-orange-200">{error}</p>}
      </section>
    );
  }

  const shown = (results ?? []).filter((entry) => !dismissed.includes(entry.label.common) && !tags.some((tag) => tag.toLowerCase() === entry.label.common.toLowerCase()));
  return (
    <section aria-label="Species suggestions" className="space-y-1.5 px-1 pb-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-100">Looks like</h3>
        <button type="button" disabled={busy || !ready} onClick={() => void analyse()} aria-label="Look again" title="Look at this photo again"
          className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/10 disabled:opacity-45"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
      </div>
      {busy && <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Looking at your photo…</p>}
      {!busy && results && shown.length === 0 && <p role="status" className="text-xs text-zinc-400">{results.length ? 'Nothing else to suggest.' : 'No clear match. Add a tag yourself, or tap Look again after cropping closer.'}</p>}
      {shown.length > 0 && (
        <ul aria-label="Suggested names" className="space-y-1">
          {shown.map((entry) => (
            <li key={entry.label.common} className="flex items-center gap-1 rounded-lg bg-white/5 pl-3 text-sm">
              <span className="min-w-0 flex-1 py-2">
                <span className="block truncate text-zinc-100">{entry.label.common}</span>
                <span className="block text-xs text-zinc-400"><i>{entry.label.scientific}</i> · {confidenceWord(entry.probability)}</span>
              </span>
              <button type="button" aria-label={`Use ${entry.label.common}`} title={`Add the tag ${entry.label.common}`}
                onClick={() => {
                  const counts = recordAccepted(readCounts(), entry.label.common);
                  try { localStorage.setItem(COUNTS_KEY, JSON.stringify(counts)); } catch { /* Learning is a bonus, not a need. */ }
                  onAccept(entry.label.common, kind ?? kindFor(entry.label));
                }}
                className="grid h-11 w-11 place-items-center rounded-md text-emerald-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><Check className="h-5 w-5" aria-hidden="true" /></button>
              <button type="button" aria-label={`Not ${entry.label.common}`} title={`Not ${entry.label.common}`} onClick={() => setDismissed((prior) => [...prior, entry.label.common])}
                className="grid h-11 w-11 place-items-center rounded-md text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-5 w-5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-orange-200">{error}</p>}
      <p className="text-xs text-zinc-500">A suggestion, not a fact. Check it before you use it.</p>
    </section>
  );
}
