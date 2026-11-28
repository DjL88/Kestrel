/**
 * Headless evaluation of the closed enhance loop (src/core/enhanceLoop.ts) over many real photographs.
 *
 *   npm run enhance-eval -- [--in <folder of JPEG previews>] [--out <folder>] [--size 600] [--no-flaws] [--only name] [--held-out-only | --dev-only]
 *
 * Inputs are downsized working previews (long edge 2048 px, made once from the open-licensed RAWs with macOS `sips`, i.e.
 * Apple's RAW decoder, NOT Kestrel's own decoder) kept outside Git. The loop itself runs on a `--size` px working copy.
 * Nothing is uploaded; nothing is written to the inputs. See scripts/enhance-eval/README.md for what is and is not real.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { relativeNoise } from '../../src/core/enhanceCritique';
import { enhancePhoto, optionLabel, type EnhanceResult, type OptionResult } from '../../src/core/enhanceLoop';
import { observeFrame, type FrameStats } from '../../src/core/enhanceObserve';
import { naturalAuto, renderRecipePreview, stageNaturalRecipe } from '../../src/core/naturalAuto';
import { DEFAULT_EDIT } from '../../src/core/photoEdits';
import { RULE_INTENTS } from '../../src/core/enhanceGuide';
import { photographyKnowledge } from '../../src/core/photographyKnowledge';
import { castDistance, downscale, jpegBase64, loadJpeg, meanAbsLightnessDiff, type Img } from './images';
import { FLAWS, FLAW_WORDS, degrade, type Flaw } from './degrade';
import { standInVision, aesthetic } from './standInVision';

interface Cat { category: string; group: string }
const CATS: Record<string, Cat | string> = JSON.parse(readFileSync(new URL('./categories.json', import.meta.url), 'utf8'));

function arg(name: string, fallback?: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Deterministic split by scene group: frames of one scene always land on the same side. */
function heldOut(group: string): boolean {
  let h = 2166136261;
  for (const ch of group) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 3 === 0;
}

interface Measures { clipHigh: number; clipLow: number; noise: number | null; spread: number; separation: number | null; cast: number | null; p50: number }
const measures = (s: FrameStats): Measures => ({
  clipHigh: s.clipHigh, clipLow: s.clipLow, noise: s.noiseSigma, spread: s.spread, p50: s.p50,
  separation: s.subject && s.subject.confidence !== 'low' ? Math.abs(s.subject.median - s.subject.backgroundMedian) : null,
  cast: s.cast ? s.cast.strength : null,
});

interface Run {
  photo: string; category: string; group: string; heldOut: boolean; variant: 'original' | Flaw;
  rules: string[]; ruleViaVision: string[]; houseSteps: number; citedSteps: number;
  options: { style: string; outcome: string; rounds: number; stop: string; steps: number; remaining: string[] }[];
  favourite: string | null; favouriteBy: string | null; totalRounds: number;
  before: Measures; after: Measures | null; auto: { outcome: string; after: Measures } | null;
  regression: string[]; autoRegression: string[];
  truth?: { degraded: number; loop: number; auto: number; castDegraded: number; castLoop: number; castAuto: number };
  standInAgrees: boolean | null; chain: string; advice: string[]; ms: number;
}

function regressions(b: Measures, a: Measures): string[] {
  const out: string[] = [];
  if (a.clipHigh - b.clipHigh > 0.005) out.push('more clipped highlights');
  if (a.clipLow - b.clipLow > 0.01) out.push('more crushed shadows');
  if (a.noise !== null && b.noise !== null && a.noise > 4 && a.noise / Math.max(255 * a.p50, 12) > (b.noise / Math.max(255 * b.p50, 12)) * 1.15) out.push('noisier (relative to brightness)');
  if (a.cast !== null && b.cast !== null && a.cast - b.cast > 0.01) out.push('stronger colour cast');
  return out;
}

async function evaluate(name: string, cat: Cat, variant: 'original' | Flaw, img: Img, truth: Img | null, keepRounds: boolean) {
  const t0 = Date.now();
  const result: EnhanceResult = await enhancePhoto({ pixels: img.rgba, width: img.width, height: img.height, vision: standInVision, keepRoundPixels: keepRounds });
  const before = measures(result.stats);
  const chosen: OptionResult | null = result.favourite !== null ? result.options[result.favourite] : null;
  const afterStats = chosen ? observeFrame(chosen.pixels, img.width, img.height) : null;
  const after = afterStats ? measures(afterStats) : null;
  // Existing Natural Auto (staged), for comparison.
  let auto: Run['auto'] = null;
  let autoPixels = img.rgba;
  try {
    const n = naturalAuto({ pixels: img.rgba, width: img.width, height: img.height });
    const staged = stageNaturalRecipe(img.rgba, img.width, img.height, DEFAULT_EDIT, { ...DEFAULT_EDIT, ...n.edit });
    autoPixels = renderRecipePreview(img.rgba, img.width, img.height, staged.edit);
    auto = { outcome: staged.outcome, after: measures(observeFrame(autoPixels, img.width, img.height)) };
  } catch { auto = null; }
  const steps = result.options.flatMap((o) => o.steps);
  const run: Run = {
    photo: name, category: cat.category, group: cat.group, heldOut: heldOut(cat.group), variant,
    rules: result.guidance.rules.map((r) => r.id), ruleViaVision: result.guidance.rules.filter((r) => r.via !== 'measured').map((r) => r.id),
    houseSteps: steps.filter((s) => !s.ruleId || !s.sources.length).length, citedSteps: steps.filter((s) => s.ruleId && s.sources.length).length,
    options: result.options.map((o) => ({ style: optionLabel(o.style), outcome: o.outcome, rounds: o.rounds.length, stop: o.stopReason, steps: o.steps.length, remaining: o.remaining.map((i) => i.id) })),
    favourite: chosen ? optionLabel(chosen.style) : null, favouriteBy: result.favouriteBy, totalRounds: result.rounds,
    before, after, auto, regression: after ? regressions(before, after) : [], autoRegression: auto ? regressions(before, auto.after) : [],
    standInAgrees: null, chain: result.chain.results.map((r) => r.outcome).join(','), advice: result.advice, ms: Date.now() - t0,
  };
  if (truth) {
    const loopPx: Img = { rgba: chosen ? chosen.pixels : img.rgba, width: img.width, height: img.height };
    const autoImg: Img = { rgba: autoPixels, width: img.width, height: img.height };
    run.truth = {
      degraded: meanAbsLightnessDiff(img, truth), loop: meanAbsLightnessDiff(loopPx, truth), auto: meanAbsLightnessDiff(autoImg, truth),
      castDegraded: castDistance(img, truth), castLoop: castDistance(loopPx, truth), castAuto: castDistance(autoImg, truth),
    };
    if (run.truth.loop > run.truth.degraded * 1.02) run.regression.push('further from the undegraded original');
  }
  if (chosen) {
    const verdict = await standInVision.critique!({ rgba: img.rgba, width: img.width, height: img.height }, { rgba: chosen.pixels, width: img.width, height: img.height }, result.guidance);
    run.standInAgrees = !verdict || verdict.issues.length === 0;
  }
  return { run, result };
}

const f2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? 'n/a' : v.toFixed(d));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pc = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

function table(rows: Run[], by: (r: Run) => string, title: string): string {
  const keys = [...new Set(rows.map(by))].sort();
  const lines = [`### ${title}`, '', '| Group | Runs | Improved | Nothing needed | Kept for review | Mean rounds | Regressions (loop) | Regressions (Natural Auto) | Clipping Δ (pp) | Shadow-crush Δ (pp) | Noise Δ | Tonal spread Δ | Separation Δ | Cast Δ |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const k of keys) {
    const rs = rows.filter((r) => by(r) === k);
    const withAfter = rs.filter((r) => r.after);
    const d = (f: (m: Measures) => number | null) => mean(withAfter.map((r) => { const a = f(r.after!), b = f(r.before); return a === null || b === null ? NaN : a - b; }).filter((v) => !Number.isNaN(v)));
    lines.push(`| ${k} | ${rs.length} | ${pc(rs.filter((r) => r.favourite).length, rs.length)} | ${pc(rs.filter((r) => !r.favourite && r.options.every((o) => o.outcome === 'nothing-needed')).length, rs.length)} | ${pc(rs.filter((r) => !r.favourite && r.options.some((o) => o.outcome === 'kept-for-review')).length, rs.length)} | ${f2(mean(rs.map((r) => r.totalRounds / 3)), 1)} | ${rs.filter((r) => r.regression.length).length} | ${rs.filter((r) => r.autoRegression.length).length} | ${f2(100 * d((m) => m.clipHigh), 2)} | ${f2(100 * d((m) => m.clipLow), 2)} | ${f2(d((m) => m.noise), 2)} | ${f2(d((m) => m.spread), 3)} | ${f2(d((m) => m.separation), 3)} | ${f2(d((m) => m.cast), 3)} |`);
  }
  return lines.join('\n');
}

function recoveryTable(rows: Run[]): string {
  const withTruth = rows.filter((r) => r.truth);
  const lines = ['| Flaw | Runs | Lightness error: flawed | after loop | after Natural Auto | Colour-balance error: flawed | after loop | after Natural Auto | Loop closer to truth (lightness) | Natural Auto closer |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const flaw of FLAWS) {
    const rs = withTruth.filter((r) => r.variant === flaw);
    if (!rs.length) continue;
    const t = (f: (x: NonNullable<Run['truth']>) => number) => f2(mean(rs.map((r) => f(r.truth!))), 3);
    lines.push(`| ${FLAW_WORDS[flaw]} | ${rs.length} | ${t((x) => x.degraded)} | ${t((x) => x.loop)} | ${t((x) => x.auto)} | ${t((x) => x.castDegraded)} | ${t((x) => x.castLoop)} | ${t((x) => x.castAuto)} | ${pc(rs.filter((r) => r.truth!.loop < r.truth!.degraded).length, rs.length)} | ${pc(rs.filter((r) => r.truth!.auto < r.truth!.degraded).length, rs.length)} |`);
  }
  return lines.join('\n');
}

async function main() {
  const inDir = resolve(arg('in', '/Users/davidleitch/code/kestrel-test-photos/previews-2048')!);
  const out = resolve(arg('out', 'enhance-eval-out')!);
  const size = Number(arg('size', '600'));
  const only = arg('only');
  mkdirSync(out, { recursive: true });
  const files = readdirSync(inDir).filter((f) => ['.jpg', '.jpeg'].includes(extname(f).toLowerCase())).sort();
  const runs: Run[] = [];
  const rows: string[] = [];
  const seenGroup = new Set<string>();
  let n = 0;
  for (const file of files) {
    const name = basename(file, extname(file));
    if (only && name !== only) continue;
    const entry = CATS[name];
    const cat: Cat = typeof entry === 'object' ? entry : { category: 'uncategorised', group: name };
    if (flag('held-out-only') && !heldOut(cat.group)) continue;
    if (flag('dev-only') && heldOut(cat.group)) continue; // tuning runs never look at the held-out groups
    const src = downscale(loadJpeg(join(inDir, file)), size);
    const first = !seenGroup.has(cat.group);
    seenGroup.add(cat.group);
    const variants: ('original' | Flaw)[] = ['original', ...(flag('no-flaws') || !first || cat.category === 'chart' ? [] : FLAWS)];
    for (const variant of variants) {
      const img = variant === 'original' ? src : degrade(src, variant);
      const { run, result } = await evaluate(name, cat, variant, img, variant === 'original' ? null : src, variant === 'original');
      runs.push(run);
      n += 1;
      console.log(`${String(n).padStart(3)} ${name.slice(0, 28).padEnd(28)} ${variant.padEnd(10)} fav=${(run.favourite ?? '—').padEnd(15)} rules=${run.rules.length} rounds=${run.totalRounds} ${run.regression.length ? 'REGRESSION: ' + run.regression.join('; ') : ''} (${run.ms} ms)`);
      rows.push(contactRow(run, result, img, variant === 'original'));
    }
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(runs, null, 1));
  writeFileSync(join(out, 'contact-sheet.html'), contactHtml(rows));
  writeFileSync(join(out, 'report.md'), report(runs, size));
  console.log(`\nWrote ${join(out, 'report.md')}, report.json and contact-sheet.html (${runs.length} runs).`);
}

function contactRow(run: Run, result: EnhanceResult, img: Img, rounds: boolean): string {
  const thumb = (px: Uint8ClampedArray, label: string, cls = '') => `<figure class="${cls}"><img alt="${label}" src="data:image/jpeg;base64,${jpegBase64({ rgba: px, width: img.width, height: img.height }, 62)}" width="${Math.round(img.width / 3)}"><figcaption>${label}</figcaption></figure>`;
  const cells = [thumb(img.rgba, `Before${run.variant === 'original' ? '' : ' (' + FLAW_WORDS[run.variant] + ')'}`)];
  result.options.forEach((o, i) => {
    const fav = result.favourite === i;
    const strip = rounds ? o.rounds.map((r) => thumb(r.pixels ?? o.pixels, `round ${r.round + 1}${r.round === o.bestRound ? ' (kept)' : ''}`, 'small')).join('') : '';
    cells.push(`<div class="opt">${thumb(o.pixels, `${optionLabel(o.style)}${fav ? ' ★ favourite' : ''} — ${o.outcome}`, fav ? 'fav' : '')}<div class="strip">${strip}</div><p>${o.stopReason}; ${o.steps.length} steps${o.remaining.length ? '; still: ' + o.remaining.map((x) => x.id).join(', ') : ''}</p></div>`);
  });
  return `<section><h3>${run.photo} · ${run.variant} · ${run.category}${run.heldOut ? ' · held-out' : ''}</h3><div class="row">${cells.join('')}</div></section>`;
}

function contactHtml(rows: string[]): string {
  return `<!doctype html><meta charset="utf-8"><title>Enhance loop contact sheet</title><style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}figcaption{font-size:12px}.fav img{outline:4px solid #000;outline-offset:2px}.fav figcaption{font-weight:700}.small img{width:90px}.strip{display:flex;gap:4px;margin-top:4px}p{font-size:12px;margin:4px 0;max-width:260px}</style>
<h1>Enhance loop: contact sheet</h1><p>STAND-IN critic and favourite (not the real on-device model). Favourite is marked with a thick outline AND the words "favourite". Previews are downsized working copies.</p>${rows.join('\n')}`;
}

function report(runs: Run[], size: number): string {
  const originals = runs.filter((r) => r.variant === 'original');
  const real = originals.filter((r) => r.category !== 'chart');
  const dev = (rs: Run[]) => rs.filter((r) => !r.heldOut), held = (rs: Run[]) => rs.filter((r) => r.heldOut);
  const fired = new Map<string, number>();
  for (const r of runs) for (const id of new Set(r.rules)) fired.set(id, (fired.get(id) ?? 0) + 1);
  const ruleIds = (photographyKnowledge.rules as readonly { id: string }[]).map((r) => r.id);
  const withIntent = Object.keys(RULE_INTENTS);
  const never = withIntent.filter((id) => !fired.has(id));
  const unreachable = ruleIds.filter((id) => !fired.has(id) && !withIntent.includes(id));
  const stops = new Map<string, number>();
  for (const r of runs) for (const o of r.options) stops.set(o.stop, (stops.get(o.stop) ?? 0) + 1);
  const disagree = runs.filter((r) => r.favourite && r.standInAgrees === false);
  const lines: string[] = [
    '# Enhance loop: headless evaluation', '',
    `Working copies: ${size}px long edge, made from 2048px previews decoded by macOS \`sips\` (Apple's RAW decoder, not Kestrel's). ${runs.length} runs: ${originals.length} real photographs (${real.length} excluding colour charts) plus ${runs.length - originals.length} synthetic flaw variants of them.`, '',
    '**What is real and what is not.** Real: the closed loop (observe, guide, propose, render with the editor\'s own preview maths, gates, tweak, three options), the knowledge rules and sources, the existing Auto gates, and the photographs. **Stand-in:** the "vision AI" here is a deterministic critic built from different measures (see standInVision.ts); it makes no scene claims, so vision observations and the real model\'s opinion were NOT exercised. Flaw variants are synthetic. The loop and the headline measures share one set of statistics code, so the *recovery against the undegraded original* tables are the independent evidence.', '',
    `Held-out: scene groups chosen by a fixed hash of the group name (never tuned against); ${new Set(held(runs).map((r) => r.group)).size} groups. Development: ${new Set(dev(runs).map((r) => r.group)).size} groups.`, '',
    '## Real photographs, by subject category', '', '### Development set', '', table(dev(real), (r) => r.category, 'Development: by category'), '', '### Held-out set (reported separately)', '', table(held(real), (r) => r.category, 'Held-out: by category'), '',
    '## Flaw recovery (synthetic flaws on real photographs; truth is the undegraded original)', '', '### Development', '', recoveryTable(dev(runs)), '', '### Held-out', '', recoveryTable(held(runs)), '',
    '## Per-flaw loop behaviour', '', table(runs.filter((r) => r.variant !== 'original'), (r) => FLAW_WORDS[r.variant as Flaw], 'All flaw variants'), '',
    '## Where it fails or is weak', '',
    `- Runs with at least one regression in the chosen result: ${runs.filter((r) => r.regression.length).length} of ${runs.length} (Natural Auto alone: ${runs.filter((r) => r.autoRegression.length).length}).`,
    ...runs.filter((r) => r.regression.length).slice(0, 25).map((r) => `  - ${r.photo} / ${r.variant}${r.heldOut ? ' (held-out)' : ''}: ${r.regression.join('; ')}`),
    `- Runs where no option improved the photo (kept as it was or for review): ${runs.filter((r) => !r.favourite).length}.`,
    `- Stop reasons across all options: ${[...stops.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `- Steps with a checked source vs house practice: ${runs.reduce((a, r) => a + r.citedSteps, 0)} cited, ${runs.reduce((a, r) => a + r.houseSteps, 0)} house practice (stated as such).`,
    `- Stand-in critic still saw a problem in the chosen result in ${disagree.length} of ${runs.filter((r) => r.favourite).length} runs (numbers said the result was safe): the numbers and the second critic disagree there.`,
    ...disagree.slice(0, 15).map((r) => `  - ${r.photo} / ${r.variant}: chosen ${r.favourite}`),
    '', '## Rules', '',
    `- Rules that fired at least once (${fired.size}): ${[...fired.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}.`,
    `- Rules with a recipe mapping that NEVER fired on this set (${never.length}): ${never.join(', ') || 'none'}.`,
    `- Rules in the knowledge base with no measurement trigger and no recipe mapping, so they cannot fire from pixels alone (${unreachable.length} of ${ruleIds.length}): these need the real on-device vision model or an explicit tag.`, '',
    '## Rounds', '', `Mean rounds per option: ${f2(mean(runs.map((r) => r.totalRounds / 3)), 2)} (limit 5). Mean time per photo: ${f2(mean(runs.map((r) => r.ms)) / 1000, 1)} s.`, '',
  ];
  return lines.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
void aesthetic;
