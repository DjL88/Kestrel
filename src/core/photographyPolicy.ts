import { photographyKnowledge, resolvePhotographyGuidance, type PhotographyObservation } from './photographyKnowledge';
import type { PhotoFrame } from './types';

/** Explicit photographer metadata only. Auto tags and disputed classifications are not evidence of intent. */
export function observationsFromFrame(frame: Pick<PhotoFrame, 'tags' | 'autoTags' | 'subjectKind' | 'subjectDisputed' | 'searchEvidence' | 'originalSha256'> & Partial<Pick<PhotoFrame, 'stableKey'>>): PhotographyObservation[] {
  const auto = new Set((frame.autoTags ?? []).map(t => t.trim().toLowerCase()));
  const tags = new Set((frame.tags ?? []).map(t => t.trim().toLowerCase()).filter(t => !auto.has(t)));
  const observations: PhotographyObservation[] = [];
  const add = (dimension: PhotographyObservation['dimension'], label: string) => observations.push({ dimension, label, confidence: 1 });
  if (!frame.subjectDisputed && frame.subjectKind === 'people') add('scene', 'skin');
  const explicit: [string, PhotographyObservation['dimension'], string][] = [
    ['golden hour','lighting','golden hour'], ['blue hour','lighting','blue hour'],
    ['silhouette','lighting','silhouette'], ['low key','lighting','low key'], ['low-key','lighting','low key'],
    ['sunrise','subject','sunrise'], ['sunset','subject','sunset'], ['night sky','subject','night landscape'],
    ['concert','subject','concert'], ['mist','scene','fog'], ['fog','scene','fog'],
    ['newborn','subject','newborn'], ['portrait','scene','skin'],
    ['soft and airy','style','soft and airy'], ['motion blur','composition','motion blur'],
  ];
  for (const [tag, dimension, label] of explicit) if (tags.has(tag)) add(dimension,label);
  // Exact matches for the rest of the knowledge vocabulary, not fuzzy classification.
  for (const rule of photographyKnowledge.rules) {
    if (tags.has(rule.label)) add(rule.dimension,rule.label);
  }
  // Reuse corroborated local visual evidence only when bound to the same original bytes.
  // OCR is never photographic evidence. Automatic scene labels are not artistic intent.
  const evidence = frame.searchEvidence;
  if (!frame.subjectDisputed && frame.originalSha256 && evidence?.schema === 1 &&
      evidence.sourceStableKey === frame.stableKey &&
      evidence.sourceSha256?.toLowerCase() === frame.originalSha256.toLowerCase() &&
      Array.isArray(evidence.subjects)) {
    const supported = new Set(evidence.subjects.filter(s => s && typeof s.value === 'string' &&
      (s.status === 'confirmed' || s.status === 'supported')).map(s => s.value.trim().toLowerCase()));
    // Only conservative region/detail protection, not inferred lighting or style.
    if (['person','people','portrait','human'].some(s => supported.has(s))) add('scene','skin');
    for (const rule of photographyKnowledge.rules) {
      if (rule.dimension === 'subject' && supported.has(rule.label) &&
          !['sunset','sunrise','concert','night landscape','fog'].includes(rule.label)) add(rule.dimension,rule.label);
    }
  }
  return Array.from(new Map(observations.map(o => [o.dimension + ':' + o.label,o])).values());
}
export function preservationPolicy(observations: readonly PhotographyObservation[] = []) {
  const knowledge = resolvePhotographyGuidance(observations);
  const ids = new Set<string>(knowledge.rules.map(r => r.id));
  const has = (...keys: string[]) => keys.some(k => ids.has(k));
  return {
    preserveLight: has('lighting.golden-hour','lighting.blue-hour','lighting.concert','scene.artificial-lighting','subject.sunset','subject.sunrise','subject.concert'),
    preserveDark: has('lighting.silhouette','lighting.low-key','subject.night-landscape'),
    preserveSoft: has('scene.fog','subject.fog','subject.newborn','style.soft-and-airy','scene.skin','subject.studio-portrait','subject.environmental-portrait','subject.headshot','composition.motion-blur'),
  };
}
