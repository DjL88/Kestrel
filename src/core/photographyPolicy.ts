import { resolvePhotographyGuidance, type PhotographyObservation } from './photographyKnowledge';
import type { PhotoFrame } from './types';

/** Explicit photographer metadata only. Auto tags and disputed classifications are not evidence of intent. */
export function observationsFromFrame(frame: Pick<PhotoFrame, 'tags' | 'autoTags' | 'subjectKind' | 'subjectDisputed'>): PhotographyObservation[] {
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
  return observations;
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
