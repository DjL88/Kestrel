import { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, RefreshCw, X } from './icons/KestrelUIIcons';
import { SPECIES_MODEL, megabytes } from '../core/speciesModel';
import { confidenceWord, kindFor, personalBonus, pickSuggestions, rankSpecies, similarPhotos, type Suggestion } from '../core/speciesMatch';
import { qualifiesForAutoTag } from '../core/autoTags';
import { gateOutcome, permitsAutomaticSpeciesTag } from '../core/categoryGate';
import { STRICT_SPECIES_PROBABILITY } from '../core/subjectRouter';
import { gateAvailable, routePicture } from '../providers/categoryGate';
import type { SquareCrop } from '../core/subjectCrop';
import { readAutoTag, readSpeciesCounts, rememberSpecies, saveAutoTag } from '../providers/speciesLearning';
import { helperReady, failureMessage, type HelperAnswer } from '../core/onlineHelper';
import { openHelperDialog, useHelperSettings } from '../providers/helperSettings';
import { HelperError, geminiTransport, imageForHelper } from '../providers/onlineHelper';
import type { SubjectKind } from '../core/subjectTags';
import { SPECIES_DOWNLOAD_BYTES, downloadSpeciesModel, embedPicture, loadSpeciesLabels, speciesStatus, speciesSubjectCrop, type SpeciesStatus } from '../providers/speciesModel';
import { viewerText as t } from '../i18n/areas/viewer';

interface Props {
  frameId: string;
  /** A picture of the photo to look at, or null while it is not ready. */
  getPicture: () => HTMLCanvasElement | null;
  ready: boolean;
  tags: string[];
  kind: SubjectKind | undefined;
  /** Add this name as a tag, and set the kind when none is chosen yet. */
  onAccept: (name: string, kind: SubjectKind | undefined) => void;
  /** The other photos in this burst, each able to produce a picture for the model to look at. */
  mates?: { id: string; /** Does it already carry this name? */ has: (name: string) => boolean; load: () => Promise<HTMLCanvasElement | null> }[];
  /** Add the name to these other photos. Only called after the user agrees. */
  onTagMates?: (ids: string[], name: string, kind: SubjectKind | undefined) => void;
  /** Can this photo be tagged automatically? Only a photo with no tags of its own can. */
  canAutoTag?: boolean;
  /** Names the user removed from this photo, which are never added to it again. */
  declined?: string[];
  /** Tag the photo by itself. Only called when the model is sure. */
  onAutoTag?: (name: string, kind: SubjectKind | undefined) => void;
}

/** Most photos looked at when offering a name to a burst, so a long burst stays quick. */
const MAX_MATES = 30;

/**
 * Suggests what a photo shows, using a model that runs on this device once it has been downloaded. Every suggestion is
 * a chip to accept or dismiss. Optional automatic tags are marked for review. Photos stay on the device.
 */
export function SpeciesSuggestions({ frameId, getPicture, ready, tags, kind, onAccept, mates = [], onTagMates, canAutoTag = false, declined = [], onAutoTag }: Props) {
  const [autoOn, setAutoOn] = useState(readAutoTag);
  const helper = useHelperSettings();
  const [asking, setAsking] = useState(false);
  const [onlineAnswer, setOnlineAnswer] = useState<HelperAnswer | null>(null);
  const [onlineNote, setOnlineNote] = useState('');
  // The latest values, read after the model has finished, since they may have changed while it was thinking.
  const latest = useRef({ canAutoTag, declined, onAutoTag, autoOn, kind, tags, frameId });
  latest.current = { canAutoTag, declined, onAutoTag, autoOn, kind, tags, frameId };
  const [status, setStatus] = useState<SpeciesStatus | 'checking'>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [gateNote, setGateNote] = useState('');
  const [dismissed, setDismissed] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const run = useRef(0);
  const embedding = useRef<Float32Array | null>(null);
  const [offer, setOffer] = useState<{ name: string; kind: SubjectKind | undefined; ids: string[] } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { void speciesStatus().then(setStatus); return () => abort.current?.abort(); }, []);

  async function analyse() {
    const picture = getPicture();
    if (!picture) { setError(t.species.notReady); return; }
    const mine = ++run.current;
    setBusy(true);
    setError('');
    try {
      // A species-only classifier cannot tell a helicopter from an Osprey. Do not
      // infer a name unless independent on-device category evidence permits it.
      const available = await gateAvailable();
      if (mine !== run.current || latest.current.frameId !== frameId) return;
      if (!available) {
        setResults([]);
        setGateNote(t.species.needsChecker);
        return;
      }
      // A centre crop can look at the sky while the bird is near the edge.
      // Do not let the category gate and bird-ID model look at different pixels.
      const { crop } = await speciesSubjectCrop(picture);
      if (mine !== run.current || latest.current.frameId !== frameId) return;
      const route = await routePicture(picture, crop);
      if (mine !== run.current || latest.current.frameId !== frameId) return;
      const gate = gateOutcome(route, latest.current.kind).species;
      if (gate === 'block') {
        setResults([]);
        setGateNote(t.species.notEnoughEvidence);
        return;
      }
      const [{ labels, vectors }, embedding_] = await Promise.all([loadSpeciesLabels(), embedPicture(picture, crop)]);
      if (mine !== run.current || latest.current.kind !== 'wildlife' || latest.current.frameId !== frameId) return;
      embedding.current = embedding_;
      const picked = pickSuggestions(rankSpecies(embedding_, labels, vectors, personalBonus(labels, readSpeciesCounts())))
        .filter((entry) => gate === 'allow' || entry.probability >= STRICT_SPECIES_PROBABILITY);
      setResults(picked);
      setGateNote(gate === 'strict' ? t.species.uncertain : '');
      // A strong match must also lead before personal ranking preferences are applied.
      const best = picked[0];
      const now = latest.current;
      if (permitsAutomaticSpeciesTag(gate) && best && now.kind === 'wildlife' && now.frameId === frameId && now.tags.length === 0 && now.autoOn && now.canAutoTag && qualifiesForAutoTag(best, embedding_, labels, vectors) && !now.declined.some((name) => name.toLowerCase() === best.label.common.toLowerCase())) {
        now.onAutoTag?.(best.label.common, kindFor(best.label));
        void findSimilar(best.label.common, kindFor(best.label));
      }
      setDismissed([]);
    } catch {
      if (mine === run.current) { setResults([]); setGateNote(t.species.checkerFailed); }
    } finally {
      if (mine === run.current) setBusy(false);
    }
  }

  // Look at each photo once, when it is ready and the model is on this device.
  useEffect(() => {
    setResults(null);
    setGateNote('');
    setDismissed([]);
    setOffer(null);
    embedding.current = null;
    setOnlineAnswer(null);
    // The local model knows animal species only. An aircraft would otherwise
    // be forced to its nearest bird, irrespective of the apparent confidence.
    if (status === 'ready' && ready && kind === 'wildlife') void analyse();
    return () => { run.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId, status, ready, kind]);

  /** After a name is accepted, see which other shots of the burst look like the same animal, and offer them the same name. */
  async function findSimilar(name: string, chosenKind: SubjectKind | undefined) {
    const mine = embedding.current;
    if (!mine || !onTagMates || !mates.some((entry) => !entry.has(name))) return;
    const at = run.current;
    setChecking(true);
    setOffer(null);
    try {
      const found: { id: string; embedding: Float32Array }[] = [];
      for (const mate of mates.filter((entry) => !entry.has(name)).slice(0, MAX_MATES)) {
        const picture = await mate.load().catch(() => null);
        if (!picture) continue;
        // Similarity between animal-only embeddings cannot establish that a mate
        // is an animal: a helicopter could otherwise inherit an Osprey tag.
        if (!(await gateAvailable())) continue;
        if (at !== run.current || latest.current.frameId !== frameId || latest.current.kind !== 'wildlife') return;
        let crop: SquareCrop | null = null;
        let allowed = false;
        try {
          const observation = await speciesSubjectCrop(picture);
          crop = observation.crop;
          if (at !== run.current || latest.current.frameId !== frameId || latest.current.kind !== 'wildlife') return;
          const route = await routePicture(picture, crop);
          allowed = gateOutcome(route, undefined).species === 'allow';
        } catch { /* No independent category evidence: leave this mate untagged. */ }
        if (at !== run.current || latest.current.frameId !== frameId || latest.current.kind !== 'wildlife') return;
        if (!allowed || !crop) continue;
        found.push({ id: mate.id, embedding: await embedPicture(picture, crop) });
        if (at !== run.current || latest.current.frameId !== frameId || latest.current.kind !== 'wildlife') return;
      }
      const ids = similarPhotos(mine, found);
      if (ids.length && at === run.current && latest.current.frameId === frameId && latest.current.kind === 'wildlife') setOffer({ name, kind: chosenKind, ids });
    } catch { /* The offer is a convenience. Without it the photo is simply tagged on its own. */ } finally {
      setChecking(false);
    }
  }

  async function download() {
    abort.current = new AbortController();
    setProgress(0);
    setError('');
    try {
      await downloadSpeciesModel(setProgress, abort.current.signal);
      setStatus('ready');
    } catch (reason) {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : t.species.downloadFailed);
    } finally {
      setProgress(null);
    }
  }

  if (status === 'checking') return null;

  /** One photo, by hand: ask the online helper and offer its answer like any other suggestion. */
  async function askOnline() {
    const picture = getPicture();
    if (!picture) return;
    setAsking(true);
    setOnlineNote('');
    setOnlineAnswer(null);
    try {
      const answer = await geminiTransport(helper.key).ask(imageForHelper(picture));
      if (answer.species) setOnlineAnswer(answer); else setOnlineNote(t.species.helperNoName);
    } catch (failure) {
      const reason = failure instanceof HelperError ? failure.failure : 'other';
      setOnlineNote(failureMessage(reason).text || t.species.helperUnreachable);
    } finally {
      setAsking(false);
    }
  }
  const helperOn = helperReady(helper, { online: navigator.onLine });
  const onlineBlock = (
    <div className="space-y-1.5">
      {helperOn ? (
        <button type="button" disabled={asking || !ready} onClick={() => void askOnline()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/15 px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45">
          {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{asking ? t.species.asking : t.species.askHelper}
        </button>
      ) : (
        <button type="button" onClick={() => openHelperDialog()} className="min-h-10 text-xs text-zinc-300 underline underline-offset-4 hover:text-white">{helper.key ? t.species.helperOff : t.species.setUpHelper}</button>
      )}
      {helperOn && <button type="button" onClick={() => openHelperDialog()} className="block min-h-10 text-xs text-zinc-400 underline underline-offset-4 hover:text-white">{t.species.helperSettings}</button>}
      {onlineNote && <p role="status" className="text-xs text-zinc-400">{onlineNote}</p>}
      {onlineAnswer?.species && onlineAnswer.kind === 'wildlife' && (kind === 'wildlife' || !kind) &&
        !tags.some((tag) => tag.toLowerCase() === onlineAnswer.species!.toLowerCase()) && (
        <ul aria-label={t.species.onlineSuggestion} className="space-y-1">
          <li className="flex items-center gap-1 rounded-lg bg-white/5 pl-3 text-sm">
            <span className="min-w-0 flex-1 py-2">
              <span className="block truncate text-zinc-100">{onlineAnswer.species}</span>
              <span className="block text-xs text-zinc-400">{onlineAnswer.scientific ? <i>{onlineAnswer.scientific}</i> : t.species.namedOnline} · {onlineAnswer.confidence === 'high' ? t.species.confidence.likely : onlineAnswer.confidence === 'medium' ? t.species.confidence.possible : t.species.confidence.unsure}</span>
            </span>
            <button type="button" aria-label={t.species.use(onlineAnswer.species)} title={t.species.addTagTitle(onlineAnswer.species)} onClick={() => { onAccept(onlineAnswer.species!, kind ?? onlineAnswer.kind); setOnlineAnswer(null); }}
              className="grid h-11 w-11 place-items-center rounded-md text-emerald-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><Check className="h-5 w-5" aria-hidden="true" /></button>
            <button type="button" aria-label={t.species.not(onlineAnswer.species)} title={t.species.not(onlineAnswer.species)} onClick={() => setOnlineAnswer(null)}
              className="grid h-11 w-11 place-items-center rounded-md text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-5 w-5" aria-hidden="true" /></button>
          </li>
        </ul>
      )}
    </div>
  );

  if (status === 'unavailable') {
    return <section aria-label={t.species.region} className="space-y-2 px-1 pb-2"><h3 className="text-sm font-medium text-zinc-100">{t.species.suggestHeading}</h3>{onlineBlock}</section>;
  }

  if (status === 'not-downloaded') {
    return (
      <section aria-label={t.species.region} className="space-y-2 px-1 pb-2">
        <h3 className="text-sm font-medium text-zinc-100">{t.species.suggestHeading}</h3>
        <p className="text-xs text-zinc-400">{t.species.downloadOffer(megabytes(SPECIES_DOWNLOAD_BYTES))}</p>
        {progress === null ? (
          <button type="button" onClick={() => void download()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/15 px-3 text-sm font-medium hover:bg-white/10">
            <Download className="h-4 w-4" aria-hidden="true" />{t.species.download(megabytes(SPECIES_DOWNLOAD_BYTES))}
          </button>
        ) : (
          <div className="space-y-1">
            <progress aria-label={t.species.downloading} className="block w-full" value={progress} max={1} />
            <button type="button" onClick={() => abort.current?.abort()} className="min-h-10 text-xs text-zinc-300 underline underline-offset-4 hover:text-white">{t.species.cancelDownload}</button>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-orange-200">{error}</p>}
        {onlineBlock}
      </section>
    );
  }

  if (kind !== 'wildlife') {
    return (
      <section aria-label={t.species.region} className="space-y-2 px-1 pb-2">
        <h3 className="text-sm font-medium text-zinc-100">{t.species.heading}</h3>
        <p className="text-xs text-zinc-400">
          {t.species.localOnly}
        </p>
        {onlineBlock}
      </section>
    );
  }
  const shown = (results ?? []).filter((entry) => !dismissed.includes(entry.label.common) && !tags.some((tag) => tag.toLowerCase() === entry.label.common.toLowerCase()));
  return (
    <section aria-label={t.species.region} className="space-y-1.5 px-1 pb-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-100">{t.species.looksLike}</h3>
        <button type="button" disabled={busy || !ready} onClick={() => void analyse()} aria-label={t.species.lookAgain} title={t.species.lookAgainTitle}
          className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/10 disabled:opacity-45"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
      </div>
      {busy && <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t.species.looking}</p>}
      {gateNote && <p role="status" className="text-xs text-zinc-400">{gateNote}</p>}
      {!busy && results && shown.length === 0 && !gateNote && <p role="status" className="text-xs text-zinc-400">{results.length ? t.species.nothingElse : t.species.noMatch}</p>}
      {shown.length > 0 && (
        <ul aria-label={t.species.suggestedNames} className="space-y-1">
          {shown.map((entry) => (
            <li key={entry.label.common} className="flex items-center gap-1 rounded-lg bg-white/5 pl-3 text-sm">
              <span className="min-w-0 flex-1 py-2">
                <span className="block truncate text-zinc-100">{entry.label.common}</span>
                <span className="block text-xs text-zinc-400"><i>{entry.label.scientific}</i> · {t.species.confidence[confidenceWord(entry.probability)]}</span>
              </span>
              <button type="button" aria-label={t.species.use(entry.label.common)} title={t.species.addTagTitle(entry.label.common)}
                onClick={() => {
                  rememberSpecies(entry.label.common);
                  const chosenKind = kind ?? kindFor(entry.label);
                  onAccept(entry.label.common, chosenKind);
                  void findSimilar(entry.label.common, chosenKind);
                }}
                className="grid h-11 w-11 place-items-center rounded-md text-emerald-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><Check className="h-5 w-5" aria-hidden="true" /></button>
              <button type="button" aria-label={t.species.not(entry.label.common)} title={t.species.not(entry.label.common)} onClick={() => setDismissed((prior) => [...prior, entry.label.common])}
                className="grid h-11 w-11 place-items-center rounded-md text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-5 w-5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      {checking && <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t.species.checkingBurst}</p>}
      {offer && (
        <div role="group" aria-label={t.species.tagSimilar} className="space-y-1.5 rounded-lg border border-sky-300/40 bg-sky-300/10 p-2">
          <p className="text-sm text-zinc-100">{t.species.offer(offer.ids.length, offer.name)}</p>
          <div className="flex gap-1">
            <button type="button" className="inline-flex min-h-11 items-center rounded-md bg-sky-300/25 px-3 text-sm font-medium text-white hover:bg-sky-300/35"
              onClick={() => { onTagMates?.(offer.ids, offer.name, offer.kind); setOffer(null); }}>{t.species.tagAll(offer.ids.length)}</button>
            <button type="button" className="min-h-11 rounded-md px-3 text-sm text-zinc-300 hover:bg-white/10" onClick={() => setOffer(null)}>{t.species.noThanks}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-orange-200">{error}</p>}
      <label className="flex min-h-10 items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={autoOn} onChange={(event) => { setAutoOn(event.target.checked); saveAutoTag(event.target.checked); }} />
        {t.species.autoTag}
      </label>
      <p className="text-xs text-zinc-400">{t.species.checkNote}</p>
    </section>
  );
}
