/**
 * Co-pilot's reading of a review comment (#1387): common photographic requests ("a bit brighter", "the sky is blown",
 * "too warm") become a small, bounded slider change that the editor approves or declines. Nothing is applied here.
 * Only plain phrases are recognised, in English and the app's other languages; anything else returns no change, so
 * the editor does it by hand. It never guesses at a subject, a mask or a crop.
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

/**
 * Words in the app's other languages, per rule. Matched from the start of a word, so inflected and compound forms
 * ("heller", "kirkkaampi", "plus lumineuse") are found. Kept to plain, common phrasing; anything else is left alone.
 */
const OTHER_LANGUAGES: Record<string, string[]> = {
  'highlights-recover': ['surexpos', 'ciel trop clair', 'hautes lumières', 'ausgebrannt', 'überstrahlt', 'lichter retten', 'himmel zu hell', 'quemad', 'cielo demasiado claro', 'altas luces', 'uitgebeten', 'lucht te licht', 'bruciat', 'cielo troppo chiaro', 'alte luci', 'céu demasiado claro', 'altas luzes', 'udbrændt', 'himlen er for lys', 'utfrätt', 'himlen är för ljus', 'utbrent', 'himmelen er for lys', 'puhki palan', 'taivas liian kirkas', 'útbrunn', 'himinninn of ljós', 'awyr yn rhy olau', 'adlewyrchiadau', 'speur ro shoilleir', 'spéir ró-gheal'],
  'shadows-lift': ['ombres trop sombres', 'déboucher les ombres', 'schatten aufhellen', 'schatten zu dunkel', 'sombras demasiado oscuras', 'aclarar las sombras', 'schaduwen ophalen', 'schaduwen te donker', 'ombre troppo scure', 'schiarire le ombre', 'sombras muito escuras', 'clarear as sombras', 'løft skyggerne', 'skyggerne er for mørke', 'lyft skuggorna', 'skuggorna är för mörka', 'løft skyggene', 'skyggene er for mørke', 'varjot liian tummat', 'nosta varjoja', 'lyfta skuggunum', 'skuggarnir of dökkir', 'cysgodion yn rhy dywyll', 'sgàilean ro dhorcha', 'scáthanna ró-dhorcha'],
  darker: ['trop clair', 'trop lumineu', 'plus sombre', 'assombri', 'zu hell', 'dunkler', 'abdunkeln', 'demasiado clar', 'más oscur', 'oscurecer', 'te licht', 'te helder', 'donkerder', 'troppo chiar', 'più scur', 'scurire', 'demasiado clar', 'mais escur', 'escurecer', 'for lys', 'mørkere', 'för ljus', 'mörkare', 'liian kirkas', 'liian vaalea', 'tummemp', 'of ljós', 'dekkri', 'rhy olau', 'tywyllach', 'ro shoilleir', 'nas dorcha', 'ró-gheal', 'níos dorcha'],
  brighter: ['trop sombre', 'trop foncé', 'plus clair', 'plus lumineu', 'éclairci', 'zu dunkel', 'heller', 'aufhellen', 'demasiado oscur', 'más clar', 'más lumin', 'aclarar', 'te donker', 'lichter maken', 'iets lichter', 'wat lichter', 'helderder', 'troppo scur', 'più chiar', 'più lumin', 'schiarire', 'demasiado escur', 'mais clar', 'clarear', 'for mørk', 'lysere', 'för mörk', 'ljusare', 'liian tumma', 'kirkkaamp', 'vaaleamp', 'of dökk', 'bjartari', 'ljósari', 'rhy dywyll', 'goleuach', 'ro dhorcha', 'nas soilleire', 'ró-dhorcha', 'níos gile'],
  cooler: ['trop chaud', 'plus froid', 'zu warm', 'kühler', 'demasiado cálid', 'más frí', 'te warm', 'koeler', 'troppo cald', 'più fredd', 'demasiado quente', 'mais fri', 'for varm', 'køligere', 'för varm', 'kallare', 'kaldere', 'liian lämmin', 'viileämp', 'of hlý', 'kaldari', 'rhy gynnes', 'oerach', 'ro bhlàth', 'nas fhuaire', 'ró-the', 'níos fuaire'],
  warmer: ['trop froid', 'plus chaud', 'zu kalt', 'wärmer', 'demasiado frí', 'más cálid', 'te koud', 'warmer', 'troppo fredd', 'più cald', 'mais quente', 'for kold', 'varmere', 'för kall', 'varmare', 'for kald', 'liian kylmä', 'lämpimämp', 'of kald', 'hlýrri', 'rhy oer', 'cynhesach', 'ro fhuar', 'nas blàithe', 'ró-fhuar', 'níos teo'],
  'less-green': ['trop vert', 'dominante verte', 'zu grün', 'grünstich', 'demasiado verde', 'te groen', 'troppo verde', 'for grøn', 'för grön', 'for grønn', 'liian vihreä', 'of græn', 'rhy wyrdd', 'ro uaine', 'ró-ghlas'],
  'less-magenta': ['trop magenta', 'trop rose', 'zu magenta', 'zu rosa', 'demasiado magenta', 'te magenta', 'troppo magenta', 'for lyserød', 'för rosa', 'for rosa', 'liian magenta', 'liian pinkki', 'of bleik', 'rhy binc', 'ro phinc', 'ró-bhándearg'],
  'less-contrast': ['trop contrast', 'moins de contraste', 'zu kontrastreich', 'weniger kontrast', 'demasiado contrast', 'menos contraste', 'te veel contrast', 'minder contrast', 'troppo contrast', 'meno contrasto', 'demasiado contraste', 'for meget kontrast', 'mindre kontrast', 'för mycket kontrast', 'for mye kontrast', 'liikaa kontrastia', 'vähemmän kontrastia', 'of mikil birtuskil', 'minni birtuskil', 'gormod o gyferbyniad', 'llai o gyferbyniad', 'cus iomsgaradh', 'nas lugha iomsgaraidh', 'an iomarca codarsnachta', 'níos lú codarsnachta'],
  'more-contrast': ['plus de contraste', 'terne', 'plat', 'mehr kontrast', 'zu flach', 'flau', 'más contraste', 'apagad', 'meer contrast', 'te vlak', 'flets', 'più contrasto', 'piatt', 'mais contraste', 'sem vida', 'mere kontrast', 'flad', 'mer kontrast', 'platt', 'mer kontrast', 'flat', 'lisää kontrastia', 'lattea', 'meiri birtuskil', 'flöt', 'mwy o gyferbyniad', 'fflat', 'barrachd iomsgaraidh', 'tuilleadh codarsnachta'],
  'less-colour': ['trop saturé', 'moins satur', 'couleurs plus naturelles', 'zu gesättigt', 'zu bunt', 'weniger sättigung', 'demasiado saturad', 'menos satur', 'te verzadigd', 'te fel', 'minder verzadig', 'troppo satur', 'meno satur', 'demasiado saturad', 'for mættet', 'mindre mætning', 'för mättad', 'mindre mättnad', 'for mettet', 'mindre metning', 'liian kylläinen', 'liian värikäs', 'of mettuð', 'minni mettun', 'rhy lachar', 'llai o liw', 'ro dhathach', 'nas lugha dath', 'ró-dhaite', 'níos lú datha'],
  'more-colour': ['plus de couleur', 'plus satur', 'couleurs ternes', 'couleurs délavées', 'mehr farbe', 'mehr sättigung', 'farben blass', 'más color', 'más satur', 'colores apagados', 'meer kleur', 'meer verzadig', 'kleuren flets', 'più colore', 'più satur', 'colori spenti', 'mais cor', 'mais satur', 'cores desbotadas', 'mere farve', 'mere mætning', 'mer färg', 'mer mättnad', 'mer farge', 'mer metning', 'lisää väriä', 'värit haaleat', 'meiri lit', 'meiri mettun', 'mwy o liw', 'barrachd dath', 'tuilleadh datha'],
  sharper: ['plus net', 'plus de détail', 'flou', 'schärfer', 'mehr details', 'unscharf', 'más nítid', 'más detalle', 'borros', 'scherper', 'meer detail', 'onscherp', 'più nitid', 'più dettagl', 'sfocat', 'mais nítid', 'mais detalhe', 'desfocad', 'skarpere', 'mere detalje', 'uskarp', 'skarpare', 'mer detalj', 'oskarp', 'flere detaljer', 'terävämp', 'epätarkka', 'skarpari', 'óskýr', 'mwy miniog', 'aneglur', 'nas gèire', 'doilleir', 'níos géire'],
  'less-noise': ['trop de bruit', 'bruit', 'granuleu', 'rauschen', 'verrauscht', 'körnig', 'ruido', 'granulos', 'ruis', 'korrelig', 'rumore', 'rumoros', 'granulos', 'ruído', 'støj', 'kornet', 'brus', 'kornig', 'støy', 'kornete', 'kohina', 'rakeinen', 'suð', 'kornótt', 'sŵn', 'grawnog', 'fuaim', 'gràineach', 'torann', 'gránach'],
};

const words = (list: string[]) => new RegExp(`(^|[^\\p{L}])(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'u');
const OTHER = Object.fromEntries(Object.entries(OTHER_LANGUAGES).map(([id, list]) => [id, words(list)])) as Record<string, RegExp>;
const LITTLE = words(['un peu', 'légèrement', 'etwas', 'ein bisschen', 'leicht', 'un poco', 'ligeramente', 'een beetje', 'iets', 'un po', 'leggermente', 'um pouco', 'ligeiramente', 'lidt', 'lite', 'litt', 'hieman', 'vähän', 'aðeins', 'örlítið', 'ychydig', 'beagan', 'beagáinín', 'rud beag']);
const MUCH = words(['beaucoup', 'bien plus', 'viel', 'deutlich', 'mucho', 'bastante', 'veel', 'flink', 'molto', 'muito', 'meget', 'mycket', 'mye', 'paljon', 'reilusti', 'miklu', 'llawer', 'mòran', 'i bhfad']);
const RANGE: Record<Key, [number, number]> = {
  exposure: [-5, 5], highlights: [-100, 100], shadows: [-100, 100], contrast: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
  temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100], clarity: [-100, 100], sharpen: [0, 100], denoiseLuminance: [0, 100],
};

/** "a bit", "slightly" halve a step; "a lot", "much" make it one and a half. */
function strength(text: string): number {
  if (LITTLE.test(text)) return 0.5;
  if (MUCH.test(text)) return 1.5;
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
    if (!rule.pattern.test(text) && !OTHER[rule.id]?.test(text)) continue;
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
