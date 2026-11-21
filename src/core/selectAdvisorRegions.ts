/**
 * Kite44 Select -> offline Photo Advisor: evidence-bound reversible proposals.
 * Values are bounded *edit parameters*, never rendered or generated pixels.
 * No inferred species label and no implicit model training/telemetry.
 */
export type AdvisorGenre = 'bird'|'aircraft'|'person'|'pet'|'sport'|'macro'|'landscape'|'architecture'|'travel'|'unknown';
export type Region = 'global'|'subject'|'sky'|'background';
export type Treatment = 'Natural'|'Subject'|'Creative';
export interface RegionEvidence {
  /** Normalised local detector/analysis quality score, NOT calibrated probability. */
  score: number;
  /** Separate boundary quality evidence: do not assume segmentation is trustworthy. */
  edgeScore: number;
  maskId: string;
  /** Immutable source binding; model mask must not outlive its source. */
  sourceSha256: string;
}
export interface AdvisorEvidence {
  photoId: string; sourceSha256: string; modelId: string; modelVersion: string;
  genre: AdvisorGenre;
  birdScore?: number; aircraftScore?: number;
  histogramReliable: boolean;
  highlightClipping: number; shadowClipping: number;
  noiseScore: number; textureScore: number;
  subject?: RegionEvidence; sky?: RegionEvidence; background?: RegionEvidence;
}
export interface Adjustment { exposureEV: number; highlights: number; shadows: number; saturation: number; clarity: number; noiseReduction: number }
export interface RegionAdjustment { region: Exclude<Region,'global'>; maskId: string; strength: number; adjustment: Adjustment }
export interface AdvisorRecipe {
  sourceSha256: string; photoId: string; kind: Treatment|'Combined';
  global: Adjustment; regions: RegionAdjustment[];
  /** Proposal only. Applying requires explicit user action in the existing editor. */
  requiresApproval: true;
}
export interface AdvisorProposals {
  status: 'ready'|'abstain';
  reason: 'ok'|'invalid-evidence'|'subject-uncertain'|'bird-aircraft-conflict'|'no-safe-change';
  recipes: readonly AdvisorRecipe[];
}
const zero = (): Adjustment => ({ exposureEV:0, highlights:0, shadows:0, saturation:0, clarity:0, noiseReduction:0 });
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const sha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
const validRegion = (r: RegionEvidence | undefined, source: string): boolean =>
  !r || (unit(r.score) && unit(r.edgeScore) && r.sourceSha256 === source &&
    typeof r.maskId === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(r.maskId));
const genres: readonly AdvisorGenre[] = ['bird','aircraft','person','pet','sport','macro','landscape','architecture','travel','unknown'];
const bound = (n: number, lo: number, hi: number) => Math.max(lo,Math.min(hi,n));
function valid(e: AdvisorEvidence): boolean {
  return typeof e.photoId === 'string' && !!e.photoId.trim() && sha(e.sourceSha256) &&
    typeof e.modelId === 'string' && !!e.modelId.trim() &&
    typeof e.modelVersion === 'string' && !!e.modelVersion.trim() &&
    genres.includes(e.genre) && typeof e.histogramReliable === 'boolean' &&
    [e.highlightClipping,e.shadowClipping,e.noiseScore,e.textureScore].every(unit) &&
    (e.birdScore === undefined || unit(e.birdScore)) &&
    (e.aircraftScore === undefined || unit(e.aircraftScore)) &&
    validRegion(e.subject,e.sourceSha256) && validRegion(e.sky,e.sourceSha256) &&
    validRegion(e.background,e.sourceSha256);
}
function contradiction(e: AdvisorEvidence): boolean {
  if (e.genre !== 'bird' && e.genre !== 'aircraft') return false;
  // Uncalibrated detector scores must never become forced wildlife IDs.
  if (!unit(e.birdScore) || !unit(e.aircraftScore)) return true;
  const own = e.genre === 'bird' ? e.birdScore : e.aircraftScore;
  const other = e.genre === 'bird' ? e.aircraftScore : e.birdScore;
  return own < .6 || other >= .55 || own - other < .2;
}
const safeRegion = (r: RegionEvidence | undefined): r is RegionEvidence =>
  !!r && r.score >= .75 && r.edgeScore >= .8;
function globalNatural(e: AdvisorEvidence): Adjustment {
  const a = zero();
  if (!e.histogramReliable) return a;
  // Protect existing clipped pixels: conservative highlight recovery, no invented data.
  a.highlights = -bound(e.highlightClipping * 25,0,15);
  a.shadows = bound(e.shadowClipping * 18,0,12);
  a.noiseReduction = bound(e.noiseScore * (1-e.textureScore) * 18,0,12);
  return a;
}
const anyEdit = (a: Adjustment) => Object.values(a).some(n => Math.abs(n)>1e-8);
const copy = (a: Adjustment): Adjustment => ({...a});
/**
 * Manual locks are explicit region/parameter names. If a parameter is locked,
 * the proposal leaves it at zero; existing manual recipe remains untouched.
 */
export function proposeSelectAdvisor(e: AdvisorEvidence, locks: readonly string[] = []): AdvisorProposals {
  const fail = (reason: AdvisorProposals['reason']): AdvisorProposals => ({status:'abstain',reason,recipes:[]});
  if (!valid(e) || locks.some(x => typeof x !== 'string')) return fail('invalid-evidence');
  if (contradiction(e)) return fail('bird-aircraft-conflict');
  const locked = new Set(locks);
  const filter = (region: Region, a: Adjustment): Adjustment => {
    const result = copy(a);
    for (const key of Object.keys(result) as (keyof Adjustment)[]) {
      if (locked.has(key) || locked.has(region+'.'+key)) result[key]=0;
    }
    return result;
  };
  const natural = filter('global',globalNatural(e));
  const local = (region: Exclude<Region,'global'>, r: RegionEvidence | undefined, a: Adjustment, strength: number): RegionAdjustment[] =>
    safeRegion(r) && !locked.has(region) && anyEdit(filter(region,a))
      ? [{region,maskId:r.maskId,strength:bound(strength,0,1),adjustment:filter(region,a)}] : [];
  const subjectAdjustment = zero();
  subjectAdjustment.shadows = 6;
  subjectAdjustment.clarity = e.textureScore > .65 ? 2 : 4;
  const skyAdjustment = zero(); skyAdjustment.highlights = -6;
  const backgroundAdjustment = zero(); backgroundAdjustment.saturation = -3;
  const subject = local('subject',e.subject,subjectAdjustment,.55);
  const sky = local('sky',e.sky,skyAdjustment,.35);
  const background = local('background',e.background,backgroundAdjustment,.25);
  const recipe = (kind: Treatment|'Combined', g: Adjustment, regions: RegionAdjustment[]): AdvisorRecipe =>
    ({photoId:e.photoId,sourceSha256:e.sourceSha256,kind,global:copy(g),
      regions:regions.map(r=>({...r,adjustment:copy(r.adjustment)})),requiresApproval:true});
  if (!anyEdit(natural) && !subject.length && !sky.length && !background.length) return fail('no-safe-change');
  // One common global transform. Combine only parameter recipes, NEVER blend separately rendered RGB.
  return {status:'ready',reason:subject.length ? 'ok' : 'subject-uncertain',recipes:[
    recipe('Natural',natural,[]),
    recipe('Subject',natural,subject),
    recipe('Creative',natural,[...sky,...background]),
    recipe('Combined',natural,[...subject,...sky,...background]),
  ]};
}
/** The renderer must revalidate this binding immediately before applying/exporting. */
export function advisorRecipeMatchesSource(recipe: AdvisorRecipe, sourceSha256: string): boolean {
  return sha(sourceSha256) && recipe.sourceSha256.toLowerCase() === sourceSha256.toLowerCase() &&
    recipe.requiresApproval === true && recipe.regions.every(r =>
      ['subject','sky','background'].includes(r.region) && /^[a-zA-Z0-9_.:-]{1,100}$/.test(r.maskId) &&
      unit(r.strength) && Object.values(r.adjustment).every(Number.isFinite));
}
