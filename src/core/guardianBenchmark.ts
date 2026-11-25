/**
 * Measuring the Vision guardian on a labelled, licensed test set (docs/QUALITY-BENCHMARKS.md). Pure: no model runs here.
 *
 * 1. `prepareGuardianCases` turns the person's labelled photos into questions, using the app's own words
 *    (`guardianQuestionText`). For every check it asks about a claim that is right and a claim that is wrong (another
 *    subject or species from the same set; a mask with part of the subject cut away), so the set measures both sides.
 * 2. The app's own model engine answers them (crates/kestrel-vision/examples/guardian_eval.rs).
 * 3. `scoreGuardian` reads the answers exactly as the app does (`readGuardianAnswer`) and reports, per check, how many
 *    wrong claims the guardian held back, how many right ones it held back needlessly, and how often it was unsure.
 *    It also re-checks the one rule that must never break: whatever the answer, a result is never upgraded.
 * Nothing here decides whether the guardian is good enough. Small sets are reported as too small to judge.
 */
import { GUARDIAN_CHECKS, guardResult, guardianQuestionText, readGuardianAnswer, type GuardedStatus, type GuardianQuestion } from './visionGuardian';

/** One labelled photo. Paths are relative to the labels file. Every label is the person's, never a model's. */
export interface GuardianLabel {
  id: string;
  image: string;
  /** The main subject in one or two plain words: "bird", "aircraft", "dog". */
  subject?: string;
  /** Common species name, when the person knows it. */
  species?: string;
  /** A black-and-white picture of the whole subject (white = subject), same aspect as the photo. */
  mask?: string;
  /** For a picture judged on its look: true when it looks natural, false when it plainly does not. */
  natural?: boolean;
}

export type MaskVariant = 'whole' | 'cut';
export interface GuardianCase {
  id: string;
  photo: string;
  image: string;
  mask?: string;
  /** How the benchmark's renderer uses the mask: as drawn, or with the top 40% of the subject's box cut away. */
  maskVariant?: MaskVariant;
  check: GuardianQuestion;
  question: string;
  /** Whether the claim the question asks about is true for this picture. */
  claimRight: boolean;
}

export interface GuardianAnswer { id: string; text: string; ms?: number }

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Deterministic pick of a different value from the set, so a wrong claim is always a plausible one. */
function otherThan<T>(values: readonly T[], own: T, salt: number): T | undefined {
  const others = values.filter((value) => value !== own);
  return others.length ? others[salt % others.length] : undefined;
}

export function prepareGuardianCases(labels: readonly GuardianLabel[]): GuardianCase[] {
  const ids = new Set<string>();
  for (const label of labels) {
    const id = clean(label?.id);
    if (!id || ids.has(id)) throw new Error('Every labelled photo needs its own id');
    if (!clean(label.image)) throw new Error(`${id}: image is missing`);
    if (label.mask !== undefined && !clean(label.mask)) throw new Error(`${id}: mask is empty`);
    if (label.mask && !clean(label.subject)) throw new Error(`${id}: a mask needs the subject word`);
    if (label.natural !== undefined && typeof label.natural !== 'boolean') throw new Error(`${id}: natural must be true or false`);
    ids.add(id);
  }
  const subjects = [...new Set(labels.map((label) => clean(label.subject).toLowerCase()).filter(Boolean))].sort();
  const species = [...new Set(labels.map((label) => clean(label.species)).filter(Boolean))].sort();
  const cases: GuardianCase[] = [];
  labels.forEach((label, index) => {
    const base = { photo: label.id.trim(), image: label.image.trim() };
    const push = (suffix: string, check: GuardianQuestion, claim: string | undefined, claimRight: boolean, extra: Partial<GuardianCase> = {}) => {
      const question = guardianQuestionText(check, claim);
      if (question) cases.push({ id: `${base.photo}:${suffix}`, ...base, ...extra, check, question, claimRight });
    };
    const subject = clean(label.subject).toLowerCase();
    const mask = clean(label.mask);
    if (subject && mask) {
      // Subject found: asked about the masked picture, so a mask on the wrong thing is what a "no" catches.
      push('subject-right', 'subjectFound', subject, true, { mask, maskVariant: 'whole' });
      const wrong = otherThan(subjects, subject, index);
      if (wrong) push('subject-wrong', 'subjectFound', wrong, false, { mask, maskVariant: 'whole' });
      push('mask-whole', 'maskComplete', subject, true, { mask, maskVariant: 'whole' });
      push('mask-cut', 'maskComplete', subject, false, { mask, maskVariant: 'cut' });
    }
    const name = clean(label.species);
    if (name) {
      push('species-right', 'speciesPlausible', name, true);
      const wrong = otherThan(species, name, index);
      if (wrong) push('species-wrong', 'speciesPlausible', wrong, false);
    }
    if (typeof label.natural === 'boolean') push('edit', 'editNatural', undefined, label.natural);
  });
  return cases;
}

/** Fewer than this many right and wrong claims for a check is reported as too few to judge. */
export const GUARDIAN_MIN_CASES = 20;

export interface GuardianCheckReport {
  check: GuardianQuestion;
  rightClaims: number;
  wrongClaims: number;
  /** Wrong claims the guardian said "no" to: results it would hold for review. */
  heldWrong: number;
  /** Right claims it said "no" to: results held needlessly (costs the person a look, never a photo or an edit). */
  heldRight: number;
  /** Plain "yes" to a wrong claim: it stays as the engine decided (never upgraded), so the engine's own checks remain. */
  passedWrong: number;
  unsure: number;
  missing: number;
  /** heldWrong / wrongClaims answered; null with no wrong claims. */
  catchRate: number | null;
  /** heldRight / rightClaims answered; null with no right claims. */
  needlessHoldRate: number | null;
  tooFewToJudge: boolean;
}

export interface GuardianReport {
  cases: number;
  answered: number;
  checks: GuardianCheckReport[];
  /** True when, for every answer and every starting status, the guardian kept or lowered the status. */
  neverUpgraded: boolean;
  medianMs: number | null;
  unexpectedAnswers: number;
}

const STATUSES: readonly GuardedStatus[] = ['apply', 'suggest', 'needs-review'];
const RANK: Record<GuardedStatus, number> = { apply: 2, suggest: 1, 'needs-review': 0 };

export function scoreGuardian(cases: readonly GuardianCase[], answers: readonly GuardianAnswer[]): GuardianReport {
  const known = new Set(cases.map((item) => item.id));
  const counts = new Map<string, number>();
  for (const answer of answers) counts.set(answer?.id, (counts.get(answer?.id) ?? 0) + 1);
  // A duplicated answer is ambiguous, so it counts as no answer rather than whichever came first.
  const byId = new Map(answers.filter((answer) => counts.get(answer.id) === 1 && typeof answer.text === 'string').map((answer) => [answer.id, answer]));
  let neverUpgraded = true;
  const times: number[] = [];
  const checks = GUARDIAN_CHECKS.map((check): GuardianCheckReport => {
    const own = cases.filter((item) => item.check === check);
    const report = { check, rightClaims: 0, wrongClaims: 0, heldWrong: 0, heldRight: 0, passedWrong: 0, unsure: 0, missing: 0 };
    let answeredRight = 0, answeredWrong = 0;
    for (const item of own) {
      if (item.claimRight) report.rightClaims += 1; else report.wrongClaims += 1;
      const answer = byId.get(item.id);
      if (!answer) { report.missing += 1; continue; }
      if (typeof answer.ms === 'number' && Number.isFinite(answer.ms) && answer.ms >= 0) times.push(answer.ms);
      const verdict = readGuardianAnswer(answer.text);
      for (const status of STATUSES) {
        if (RANK[guardResult(status, [{ source: 'on-device', verdict, question: check }]).status] > RANK[status]) neverUpgraded = false;
      }
      if (verdict === 'unsure') { report.unsure += 1; continue; }
      if (item.claimRight) { answeredRight += 1; if (verdict === 'disagrees') report.heldRight += 1; }
      else { answeredWrong += 1; if (verdict === 'disagrees') report.heldWrong += 1; else report.passedWrong += 1; }
    }
    return {
      ...report,
      catchRate: answeredWrong ? report.heldWrong / answeredWrong : null,
      needlessHoldRate: answeredRight ? report.heldRight / answeredRight : null,
      tooFewToJudge: report.rightClaims < GUARDIAN_MIN_CASES || report.wrongClaims < GUARDIAN_MIN_CASES,
    };
  }).filter((report) => report.rightClaims + report.wrongClaims > 0);
  times.sort((a, b) => a - b);
  return {
    cases: cases.length,
    answered: cases.filter((item) => byId.has(item.id)).length,
    checks,
    neverUpgraded,
    medianMs: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
    unexpectedAnswers: answers.filter((answer) => !known.has(answer?.id)).length,
  };
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);

/** A short plain-English summary for the PR or the finish-line board. Measured numbers only; no verdict on quality. */
export function describeGuardianReport(report: GuardianReport): string {
  const lines = [`${report.answered} of ${report.cases} questions answered; median ${report.medianMs ?? 'n/a'} ms each.`,
    report.neverUpgraded ? 'Never upgraded a result: PASS.' : 'Upgraded a result: FAIL (must never happen).'];
  for (const check of report.checks) {
    lines.push(`${check.check}: held ${check.heldWrong} of ${check.wrongClaims} wrong claims (${pct(check.catchRate)}), ` +
      `held ${check.heldRight} of ${check.rightClaims} right ones needlessly (${pct(check.needlessHoldRate)}), ` +
      `${check.unsure} unsure, ${check.missing} unanswered${check.tooFewToJudge ? '; too few to judge' : ''}.`);
  }
  return lines.join('\n');
}
