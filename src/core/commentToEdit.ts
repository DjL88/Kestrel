/**
 * Co-pilot's reading of a review comment (#1387): common photographic requests ("a bit brighter", "the sky is blown",
 * "too warm") become a small, bounded slider change that the editor approves or declines. Nothing is applied here.
 * Only plain phrases are recognised, in English for now; anything else returns no change, so the editor does it by
 * hand. It never guesses at a subject, a mask or a crop.
 */
export interface CommentRecipe {
  exposure: number; highlights: number; shadows: number; contrast: number; whites: number; blacks: number;
  temperature: number; tint: number; vibrance: number; saturation: number; clarity: number; sharpen: number; denoiseLuminance: number;
}

type Key = keyof CommentRecipe;
interface Rule { id: string; pattern: RegExp; change: Partial<Record<Key, number>> }

/** Checked in order; a later rule for the same slider is ignored, so "brighter, not too bright" stays one step. */
const RULES: Rule[] = [
  { id: 'highlights-recover', pattern: /\b(blown|burnt?[- ]out|clipp(ed|ing)|recover (the )?highlights|sky (is )?too bright|highlights? (are |is )?too bright)\b/, change: { highlights: -25, whites: -10 } },
  { id: 'shadows-lift', pattern: /\b(lift (the )?shadows|shadows? (are |is )?(too )?(dark|crushed|heavy)|open (up )?(the )?shadows|more shadow detail)\b/, change: { shadows: 20 } },
  { id: 'darker', pattern: /\b(too (bright|light)|darker|overexposed|over-exposed|tone (it )?down)\b/, change: { exposure: -0.3 } },
  { id: 'brighter', pattern: /\b(too dark|brighter|lighter|underexposed|under-exposed|brighten)\b/, change: { exposure: 0.3 } },
  { id: 'cooler', pattern: /\b(too (warm|yellow|orange)|cooler|less warm)\b/, change: { temperature: -10 } },
  { id: 'warmer', pattern: /\b(too (cold|cool|blue)|warmer|less (cool|blue))\b/, change: { temperature: 10 } },
  { id: 'less-green', pattern: /\b(too (green)|green (cast|tint)|less green)\b/, change: { tint: 8 } },
  { id: 'less-magenta', pattern: /\b(too (magenta|pink)|magenta (cast|tint)|less (magenta|pink))\b/, change: { tint: -8 } },
  { id: 'less-contrast', pattern: /\b(too (contrasty|harsh|punchy)|less contrast|softer|flatter)\b/, change: { contrast: -15 } },
  { id: 'more-contrast', pattern: /\b(more contrast|punchier|more punch|too flat|flat|dull|more pop)\b/, change: { contrast: 15 } },
  { id: 'less-colour', pattern: /\b(too (saturated|vivid|colou?rful)|less (saturat\w*|colou?r|vivid)|more natural colou?rs?|muted)\b/, change: { vibrance: -15 } },
  { id: 'more-colour', pattern: /\b(more (saturat\w*|colou?r|vivid|vibran\w*)|colou?rs? (look |are |is )?(washed out|dull|flat)|richer colou?rs?)\b/, change: { vibrance: 15 } },
  { id: 'sharper', pattern: /\b(sharper|more (detail|sharpness|crisp\w*)|soft focus|looks soft|crisper|not sharp)\b/, change: { sharpen: 15, clarity: 8 } },
  { id: 'less-noise', pattern: /\b(noisy|grainy|too much (noise|grain)|less (noise|grain)|clean (it )?up the noise)\b/, change: { denoiseLuminance: 20 } },
];

const RANGE: Record<Key, [number, number]> = {
  exposure: [-5, 5], highlights: [-100, 100], shadows: [-100, 100], contrast: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
  temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100], clarity: [-100, 100], sharpen: [0, 100], denoiseLuminance: [0, 100],
};

/** "a bit", "slightly" halve a step; "a lot", "much" make it one and a half. */
function strength(text: string): number {
  if (/\b(a (little )?bit|slightly|a touch|touch|tiny|subtle|little)\b/.test(text)) return 0.5;
  if (/\b(a lot|much|way|far|really|very|lots)\b/.test(text)) return 1.5;
  return 1;
}

export interface CommentEdit { rules: string[]; delta: Partial<CommentRecipe> }

export function commentToEdit(comment: string, current: Readonly<CommentRecipe>): CommentEdit {
  const text = comment.toLocaleLowerCase('en-GB').replace(/[’']/g, "'").replace(/\s+/g, ' ');
  const scale = strength(text);
  const delta: Partial<CommentRecipe> = {};
  const rules: string[] = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const keys = Object.keys(rule.change) as Key[];
    if (keys.some((key) => key in delta)) continue;
    rules.push(rule.id);
    for (const key of keys) {
      const [low, high] = RANGE[key];
      const step = rule.change[key]! * scale;
      const next = Math.min(high, Math.max(low, current[key] + step));
      const rounded = key === 'exposure' ? Math.round(next * 100) / 100 : Math.round(next);
      if (rounded !== current[key]) delta[key] = rounded;
    }
  }
  return { rules, delta };
}
