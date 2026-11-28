import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { AUTO_REASON_KEYS, autoReasonKey } from './autoReasons';
import { source } from '../i18n/areas/engine/source';
import { engineArea } from '../i18n/areas/engine';
import { LANGUAGES } from './locale';
import { naturalAuto, renderRecipePreview } from './naturalAuto';
import { superviseAutoRender } from './autoRenderSupervisor';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { darkBackgroundBird } from './syntheticScenes';
import { planAuto, settleAfterRender, type AutoPlan } from './unifiedAuto';
import { mergeAutoSuggestion } from './autoEnhance';

/** Every reason a safety check can give is found by reading the checks' own source, so a new reason cannot be left without words. */
const FILES = ['autoQualityGate.ts', 'autoRenderSupervisor.ts', 'naturalAuto.ts', 'unifiedAuto.ts', '../v2/engineClient/runAuto.ts', '../v2/engineClient/renderAutoCandidates.ts'];
function reasonsInSource(): string[] {
  const found = new Set<string>();
  for (const file of FILES) {
    const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of text.matchAll(/(?:blocked|fail)\('([^']+)'\)|safe: false, reason: '([^']+)'|rejected\[0\] \?\? '([^']+)'|reason: '(No preferred[^']+)'|\['(Preview renderer unavailable)'\]/g)) {
      found.add(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
    }
  }
  return [...found];
}

test('every reason a safety check gives has plain words, and every key is said in every language', () => {
  const reasons = reasonsInSource();
  assert.ok(reasons.length >= 15, `found the checks' reasons: ${reasons.length}`);
  for (const reason of reasons) assert.notEqual(autoReasonKey(reason), null, `no words for: ${reason}`);
  assert.deepEqual(Object.keys(source.auto.reasons).sort(), [...AUTO_REASON_KEYS].sort());
  for (const { code } of LANGUAGES) {
    const words = (engineArea.translations[code] as typeof source | undefined)?.auto?.reasons as Record<string, string> | undefined;
    if (code.startsWith('en') || code.includes('-')) continue;
    for (const key of AUTO_REASON_KEYS) assert.ok(words?.[key]?.trim(), `${code}: ${key} is not said`);
    for (const key of AUTO_REASON_KEYS) assert.notEqual(words![key], source.auto.reasons[key], `${code}: ${key} was left in English`);
  }
  assert.equal(autoReasonKey('something new'), null);
  assert.equal(autoReasonKey(undefined), null);
});

test('the reasons say what the owner saw: a small subject, blown water specks, and a dark look kept on purpose', () => {
  assert.equal(autoReasonKey('A detected subject is too small to verify'), 'subjectSmall');
  assert.equal(autoReasonKey('More pure-white clipping'), 'clipWhite');
  assert.match(source.auto.reasons.subjectSmall, /small in the frame/);
  assert.match(source.auto.reasons.clipWhite, /water specks/);
  assert.match(source.auto.reasons.keptDark, /dark on purpose/);
});

test('a bird too small for the check to measure is declined with that reason, not a vague one', () => {
  const scene = darkBackgroundBird(50);
  // A mask that covers a handful of pixels: the supervisor cannot verify what it cannot measure.
  const tiny = new Float32Array(scene.width * scene.height);
  for (let i = 0; i < 6; i += 1) tiny[(scene.height / 2) * scene.width + scene.width / 2 + i] = 1;
  const before = renderRecipePreview(scene.pixels, scene.width, scene.height, DEFAULT_EDIT);
  const after = renderRecipePreview(scene.pixels, scene.width, scene.height, { ...DEFAULT_EDIT, exposure: 1 });
  const review = superviseAutoRender({ data: before, width: scene.width, height: scene.height }, { data: after, width: scene.width, height: scene.height }, [tiny]);
  assert.equal(review.safe, false);
  assert.equal(autoReasonKey(review.reason), 'subjectSmall');
});

const planFor = (verdict: AutoPlan['verdict'], proposal: PhotoEdit): AutoPlan => ({
  base: DEFAULT_EDIT, proposal, verdict, notes: [],
  measured: { subjectMedian: 0.2, highlightP98: 0.4, reference: 'subject', lowKey: true, colourWarnings: [] },
  species: { status: 'abstained', warmthDelta: 0, reason: '' } as AutoPlan['species'],
});

test('with no recipe proposed, the plan\'s own verdict stands instead of "cannot improve this safely"', () => {
  const looksGood = planFor({ kind: 'looks-good' }, DEFAULT_EDIT);
  const settled = settleAfterRender({ plan: looksGood, naturalPlan: looksGood, base: DEFAULT_EDIT, recipeCount: 0, candidateEdits: [], rejected: [] });
  assert.equal(settled.verdict.kind, 'looks-good', 'the owner\'s kingfisher: nothing proposed is not "unsafe"');
  const declined = planFor({ kind: 'cannot-improve-safely', reason: 'A detected subject is too small to verify' }, DEFAULT_EDIT);
  assert.equal(settleAfterRender({ plan: declined, naturalPlan: declined, base: DEFAULT_EDIT, recipeCount: 0, candidateEdits: [], rejected: [] }).verdict.kind, 'cannot-improve-safely');
});

test('a proposed recipe whose render fails the checks is declined with that check\'s own reason', () => {
  const proposal: PhotoEdit = { ...DEFAULT_EDIT, exposure: 1 };
  const improved = planFor({ kind: 'improved', outcome: 'full' }, proposal);
  const settled = settleAfterRender({ plan: improved, naturalPlan: improved, base: DEFAULT_EDIT, recipeCount: 1, candidateEdits: [], rejected: ['More pure-white clipping'] });
  assert.equal(settled.verdict.kind, 'cannot-improve-safely');
  assert.equal(settled.proposal, DEFAULT_EDIT);
  assert.equal(settled.verdict.kind === 'cannot-improve-safely' && autoReasonKey(settled.verdict.reason), 'clipWhite');
  const kept = settleAfterRender({ plan: improved, naturalPlan: improved, base: DEFAULT_EDIT, recipeCount: 1, candidateEdits: [proposal], rejected: [] });
  assert.equal(kept.verdict.kind, 'improved');
});

test('the kingfisher repro end to end: our own low-key tag still gets a checked lift; the person\'s own tag says why it did not', () => {
  const scene = darkBackgroundBird(50);
  const segmentation = { grid: scene.grid, confidence: 'high' as const };
  const base = DEFAULT_EDIT;
  for (const hints of [{ preserveDark: true, darkMeasuredOnly: true }, { preserveDark: true }]) {
    const natural = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation, sceneHints: hints });
    const proposal = mergeAutoSuggestion(base, natural.edit).edit;
    const plan = planAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, base, proposal, natural, segmentation });
    if (hints.darkMeasuredOnly) assert.equal(plan.verdict.kind, 'improved');
    else { assert.equal(plan.verdict.kind, 'looks-good'); assert.equal(natural.heldBack, 'dark-on-purpose'); }
  }
});
