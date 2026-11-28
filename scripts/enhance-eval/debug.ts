/** Print one photo's loop round by round: npm run enhance-eval:debug -- <name> [flaw] */
import { join } from 'node:path';
import { enhancePhoto, optionLabel } from '../../src/core/enhanceLoop';
import { degrade, type Flaw } from './degrade';
import { downscale, loadJpeg } from './images';
import { standInVision } from './standInVision';
const [name, flaw] = process.argv.slice(2);
const dir = process.env.ENHANCE_EVAL_IN ?? '/Users/davidleitch/code/kestrel-test-photos/previews-2048';
const src = downscale(loadJpeg(join(dir, `${name}.jpg`)), 600);
const img = flaw ? degrade(src, flaw as Flaw) : src;
const r = await enhancePhoto({ pixels: img.rgba, width: img.width, height: img.height, vision: standInVision });
const s = r.stats;
console.log('stats', { p05: s.p05, p50: s.p50, p95: s.p95, p99: s.p99, clipHigh: s.clipHigh, clipLow: s.clipLow, spread: s.spread, noise: s.noiseSigma, cast: s.cast, chroma: s.meanChroma, tilt: s.tilt, subject: s.subject && { cov: s.subject.coverage, med: s.subject.median, bg: s.subject.backgroundMedian, conf: s.subject.confidence } });
console.log('rules', r.guidance.rules.map((x) => x.id), 'held-unknown', r.guidance.unknown.length);
for (const o of r.options) {
  console.log(`\n== ${optionLabel(o.style)} -> ${o.outcome} (${o.stopReason}) best round ${o.bestRound + 1}; held: ${o.held.join(' | ')}`);
  for (const k of o.rounds) console.log(` r${k.round + 1} score ${k.score.toFixed(3)} gate=${k.gateSafe ? 'ok' : k.gate} issues=[${k.issues.map((i) => i.id + '/' + i.source[0]).join(',')}] p50 ${k.p50.toFixed(2)} clipH ${(k.clipHigh * 100).toFixed(2)} noise ${k.noiseSigma?.toFixed(1)} knobs ${JSON.stringify(Object.fromEntries(Object.entries(k.knobs).filter(([, v]) => v)))}`);
}
