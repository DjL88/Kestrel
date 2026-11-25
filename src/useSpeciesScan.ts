import { useConnectivity } from './providers/useConnectivity';
import { validateSpecies } from './providers/speciesValidator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { qualifiesForAutoTag, scanCandidates, scanPatch } from './core/autoTags';
import { SPECIES_MODEL } from './core/speciesModel';
import { kindFor, personalBonus, pickSuggestions, rankSpecies } from './core/speciesMatch';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { pictureForAnalysis } from './providers/pictureForAnalysis';
import { SPECIES_DOWNLOAD_BYTES, analysePicture, downloadSpeciesModel, loadSpeciesLabels, speciesStatus, type SpeciesStatus } from './providers/speciesModel';
import { readAutoTag, readSpeciesCounts } from './providers/speciesLearning';
import { gateOutcome, permitsAutomaticSpeciesTag } from './core/categoryGate';
import { subjectCrop } from './core/subjectCrop';
import { gateAvailable, routeAndEmbedPicture } from './providers/categoryGate';
import { readVehicle, type VehicleReading } from './core/vehicleRecognition';
import { loadVehicleData } from './providers/vehicleRecognition';
import { findMarkings, findRaceNumber, markingContext } from './core/aircraftRegistration';
import { lookUpMarking } from './core/aircraftRegister';
import { withMarking } from './core/vehicleRecognition';
import { VEHICLE_LABELS } from './core/vehicleLabels';
import { markingReaderReady, readText } from './providers/markingReader';
import { loadFaaRegister } from './providers/aircraftRegisters';
import { findSubjects } from './providers/objectDetector';
import { guardVehicleOnDevice } from './providers/vehicleGuardian';
import { HELPER_GAP_MS, HELPER_SESSION_CAP, failureMessage, helperPatch, helperReady } from './core/onlineHelper';
import { ONLINE_HELPER_VISIBLE, useHelperSettings } from './providers/helperSettings';
import { HelperError, geminiTransport, imageForHelper } from './providers/onlineHelper';
import { appText as t } from './i18n/areas/app';

/** What one look at a photo found: a species name, or a vehicle reading (kind and probable type), or only that it was looked at. */
export type ScanResult = ReturnType<typeof scanPatch> & { vehicle?: VehicleReading };

/**
 * Read a registration or serial from an aircraft, only when the photo is an aircraft and the person installed the
 * markings reader. Text is read only inside the detector's aeroplane boxes (the whole picture for a helicopter, which the
 * detector has no class for). Any failure leaves the reading as it was.
 */
async function readMarkings(vehicle: VehicleReading, store: BrowserPreviewProvider, frame: PhotoFrame): Promise<VehicleReading> {
  const context = markingContext(vehicle);
  if (!context || !(await markingReaderReady())) return vehicle;
  try {
    const large = await pictureForAnalysis(store, frame, 2048);
    if (!large) return vehicle;
    const planes = (await findSubjects(large).catch(() => [])).filter((found) => (context === 'aircraft' ? found.detection.label === 'aeroplane' : found.detection.label === 'car' || found.detection.label === 'motorcycle') && found.detection.score >= 0.4);
    const areas = planes.length ? planes.map(({ detection: { box } }) => {
      const pad = 0.05 * Math.max(box.w, box.h);
      const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
      return { x, y, width: Math.min(large.width - x, box.w + 2 * pad), height: Math.min(large.height - y, box.h + 2 * pad) };
    }) : [{ x: 0, y: 0, width: large.width, height: large.height }];
    const lines = [];
    for (const area of areas.slice(0, 3)) lines.push(...(await readText(large, area)).map((line) => ({ ...line, height: line.box.height })));
    const needsFaa = lines.some((line) => findMarkings(line.text).some((marking) => marking.format === 'us-civil'));
    const faa = needsFaa ? await loadFaaRegister().catch(() => null) : null;
    const typeName = (id: string) => VEHICLE_LABELS.types.find((entry) => entry.id === id)?.name;
    if (context === 'racing') return withMarking(vehicle, lines, findRaceNumber, () => null);
    return withMarking(vehicle, lines, findMarkings, (marking) => {
      const match = lookUpMarking(marking, { faa }, vehicle.kind, typeName);
      if (!match) return null;
      const { kind: _kind, ...registered } = match;
      return registered;
    });
  } catch {
    return vehicle;
  }
}

/** Photos sent to the online helper in this session, across projects. Counted so the cap holds however often it restarts. */
let helperSent = 0;

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the project page is showing. Looking pauses while a photo is being edited. */
  active: boolean;
  onResult: (frameId: string, patch: ScanResult) => void;
}

/** Identifies untagged photos quietly, using the on-device model first. */
export function useSpeciesScan({ projectId, frames, provider, active, onResult }: Options) {
  const [status, setStatus] = useState<SpeciesStatus | 'checking'>('checking');
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState('');
  const online = useConnectivity() !== 'offline';
  const helper = useHelperSettings();
  const helperOn = helperReady(helper, { online });
  const localReady = status === 'ready';
  const sources = useRef({ localReady, helperOn, key: helper.key });
  sources.current = { localReady, helperOn, key: helper.key };
  const helperHalted = useRef(false);
  const latest = useRef({ projectId, frames, provider, active, onResult });
  latest.current = { projectId, frames, provider, active, onResult };
  const running = useRef(false);
  const cancelled = useRef(false);
  const skipped = useRef(new Set<string>());

  useEffect(() => { void speciesStatus().then(setStatus); }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const localLabels = await loadSpeciesLabels().catch(() => null);
      const vehicleData = await loadVehicleData().catch(() => null);
      for (;;) {
        const { projectId: currentId, frames: current, provider: store, onResult: report } = latest.current;
        const stillCurrent = () => !cancelled.current && latest.current.active && latest.current.projectId === currentId;
        const available = sources.current;
        if (!stillCurrent() || !store || !readAutoTag()) break;
        const canAsk = () => sources.current.helperOn && sources.current.key === available.key &&
          !helperHalted.current && helperSent < HELPER_SESSION_CAP;
        if (!available.localReady && !canAsk()) break;
        const frameKey = (id: string) => `${currentId}|${id}`;
        // With the category gate, the local model may look at unclassified photos too: the gate, not the species list,
        // decides whether a photo is an animal at all.
        const gateOn = available.localReady && await gateAvailable();
        const frame = scanCandidates(current, { includeUnclassified: canAsk() || gateOn }).find((candidate) => !skipped.current.has(frameKey(candidate.id)));
        if (!frame) break;

        // What the person owns about this photo, to notice if they change it while the models are thinking
        // (carried over from #439). Object identity is not enough: a catalogue reload replaces objects unchanged.
        const manualState = (item: PhotoFrame) => JSON.stringify([
          item.removedAt, item.decision, item.rating, item.subjectKind, item.tags, item.subjectNames, item.declinedTags, item.autoTags,
        ]);
        const before = manualState(frame);
        const picture = await pictureForAnalysis(store, frame).catch(() => null);
        if (!stillCurrent()) continue;
        if (!picture) { skipped.current.add(frameKey(frame.id)); continue; }

        let patch: ScanResult | undefined;
        if (available.localReady && localLabels) {
          try {
            // analysePicture locates the subject on-device before comparing it with the saved species vectors.
            const { labels, vectors } = localLabels;
            const { embedding, grid } = await analysePicture(picture);
            const top = pickSuggestions(rankSpecies(embedding, labels, vectors, personalBonus(labels, readSpeciesCounts())))[0];
            const qualified = top && qualifiesForAutoTag(top, embedding, labels, vectors) ? top : undefined;
            const crop = subjectCrop(picture.width, picture.height, grid);
            // With the optional BioCLIP 2 validator installed (desktop), a clear disagreement withholds the automatic
            // name: the photo stays for the person to name. Agreement or an unsure validator changes nothing.
            const verdict = qualified ? await validateSpecies(picture, crop, qualified.label).catch(() => null) : null;
            const best = verdict?.kind === 'differs' ? undefined : qualified;
            const named = best ? { name: best.label.common, probability: best.probability, kind: kindFor(best.label) } : undefined;
            // The gate looks at the same square as the species model. If it fails, nothing is decided for this photo.
            const gate = await routeAndEmbedPicture(picture, crop);
            const outcome = gateOutcome(gate.route, frame.subjectKind);
            // The same picture embedding says what kind of vehicle it is, if the gate says it is mostly a vehicle.
            const vehicle = vehicleData && !frame.vehicle && !frame.vehicleDeclined ? readVehicle(gate.embedding, gate.route, vehicleData.labels, vehicleData.vectors) : null;
            const kind = frame.subjectKind ?? outcome.kind;
            if (kind === 'wildlife' && outcome.species !== 'block') {
              // A high closed-set species score never cancels uncertainty in
              // the independent animal/aircraft check. Strict = review only.
              patch = scanPatch({ ...frame, subjectKind: kind }, permitsAutomaticSpeciesTag(outcome.species) ? named : undefined);
              if (outcome.kind) patch = { ...patch, subjectKind: outcome.kind };
            } else if (kind) {
              // Not an animal the list can name (a helicopter, a car): looked at, and no animal name offered.
              patch = { speciesChecked: true };
            }
            // In a burst whose aircraft is already named (a register match or the person's own choice), the slower
            // text reading and guardian question are skipped: the name is carried across the burst instead.
            const settled = frame.burstGroupId && frame.burstCount > 1 && !frame.burstUngrouped && current.some((mate) => mate.id !== frame.id &&
              mate.burstGroupId === frame.burstGroupId && !mate.vehicle?.carriedFrom && (mate.vehicle?.source === 'person' || mate.vehicle?.registered));
            if (vehicle) patch = { ...(patch ?? {}), speciesChecked: true, vehicle: settled ? vehicle : await guardVehicleOnDevice(await readMarkings(vehicle, store, frame), picture) };
            // Unclassified and not clearly an animal: unknown stays unknown, and the opted-in helper may still answer.
          } catch { /* A failed local analysis can still use the opted-in fallback. */ }
        }
        if (!stillCurrent() || !readAutoTag()) continue;

        let asked = false;
        if (!patch?.tags?.length && !patch?.vehicle && canAsk()) {
          asked = true;
          helperSent += 1;
          try {
            const answer = await geminiTransport(available.key).ask(imageForHelper(picture));
            if (sources.current.helperOn && sources.current.key === available.key) patch = helperPatch(frame, answer);
          } catch (failure) {
            if (sources.current.key === available.key && failure instanceof HelperError && failureMessage(failure.failure).stops) {
              helperHalted.current = true;
            }
          }
        }
        if (!stillCurrent() || !readAutoTag()) continue;
        // A result worked out from an older state of the photo is not written; the photo is looked at again later.
        const live = latest.current.frames.find((item) => item.id === frame.id);
        if (!live || live.removedAt != null || manualState(live) !== before) continue;
        skipped.current.add(frameKey(frame.id));
        if (patch) report(frame.id, patch);
        await new Promise((resolve) => window.setTimeout(resolve, asked ? HELPER_GAP_MS : 30));
      }
    } finally {
      running.current = false;
    }
  }, []);

  const ready = status !== 'checking' && (localReady || helperOn) && active && provider !== null;
  useEffect(() => { helperHalted.current = false; }, [helper.key, helper.enabled, online]);
  useEffect(() => {
    if (!ready) return;
    cancelled.current = false;
    void run();
    return () => { cancelled.current = true; };
  }, [ready, localReady, helperOn, helper.key, run]);

  // Photos the scan would look at now; with the helper off, unclassified photos still count, so the banner can offer it.
  const waiting = scanCandidates(frames, { includeUnclassified: helperOn || ONLINE_HELPER_VISIBLE }).length;
  useEffect(() => {
    if (ready && waiting > 0 && !running.current) { cancelled.current = false; void run(); }
  }, [ready, waiting, run]);

  async function download() {
    if (!online) { setError(t.species.downloadFailed); return; }
    setDownloading(0);
    setError('');
    try {
      await downloadSpeciesModel(setDownloading);
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.species.downloadFailed);
    } finally {
      setDownloading(null);
    }
  }

  return { status, helperOn, downloading, download, error, size: SPECIES_DOWNLOAD_BYTES, pending: waiting };
}
