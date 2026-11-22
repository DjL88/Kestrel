import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Irish. DRAFT: written without a native speaker's check. Colour names sit in brackets or after a colon so they keep their base form. */
export const ga: AreaTranslation<typeof source> = {
  title: 'Seiceáil datha',
  intro: 'Ainmníonn InFlight na dathanna sa ghrianghraf seo agus insíonn sé duit, i bhfocail, faoi aon rud a d’fhéadfadh a bheith cearr.',
  checking: 'Ag seiceáil an datha…',
  unavailable: 'Níl an tseiceáil datha ar fáil don ghrianghraf seo fós.',
  mainColours: 'Príomhdhathanna',
  nothingToFix: 'Níl cuma cearr ar an dath sa réamhamharc beag seo.',
  watchOut: 'Aire:',
  tip: 'Leid:',
  note: 'Nóta:',
  family: {
    red: 'dearg', orange: 'oráiste', brown: 'donn', yellow: 'buí', lime: 'glasbhuí', green: 'glas', teal: 'gormghlas',
    blue: 'gorm', purple: 'corcra', pink: 'bándearg', grey: 'liath', black: 'dubh', white: 'bán',
  },
  strength: { none: 'gan dath', muted: 'bog', moderate: 'measartha', strong: 'láidir', veryStrong: 'an-láidir' },
  share: (percent) => (percent >= 45 ? 'thart ar a leath nó níos mó' : percent >= 25 ? 'thart ar an gceathrú cuid nó níos mó' : percent >= 10 ? 'cuid mhaith' : 'beagán'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} agus ${second}`,
  strongColour: (colours, percent) => `Clúdaíonn dath an-láidir (${colours}) ${percent}% den ghrianghraf. D’fhéadfadh cuma mhínádúrtha a bheith air ar an scáileán agus d’fhéadfadh sé priontáil go dona.`,
  clippedColour: (colours) => `Tá roinnt limistéar (${colours}) ró-láidir chun a mionsonraí a thaispeáint, mar sin tá cuma chothrom orthu.`,
  cast: {
    warm: 'Tá cuma beagán buí nó oráiste (imir the) ar rudaí ar cheart dóibh a bheith liath nó bán.',
    cool: 'Tá cuma beagán gorm (imir fhuar) ar rudaí ar cheart dóibh a bheith liath nó bán.',
    green: 'Tá cuma beagán glas ar rudaí ar cheart dóibh a bheith liath nó bán.',
    magenta: 'Tá cuma beagán bándearg nó corcra ar rudaí ar cheart dóibh a bheith liath nó bán.',
  },
  castClear: 'Tá an imir soiléir go leor go dtabharfaidh formhór na ndaoine faoi deara í.',
  muted: 'Is beag dath atá sa ghrianghraf seo. Tá sé sin ceart go leor más mian leat é a bheith beagnach dubh agus bán.',
  redGreen: (first, second) => `Tá na limistéir (${first} agus ${second}) beagnach chomh geal lena chéile, mar sin beidh sé deacair ar go leor daoine atá dathdhall iad a aithint óna chéile.`,
  redGreenHint: 'Má dhéanann tú ceann acu níos gile nó níos dorcha, feicfidh gach duine an difríocht níos fearr.',
  subject: (subjectColour, strength, surroundings) => `D’ábhar: ${subjectColour}, ${strength}. Timpeall air: ${surroundings} den chuid is mó.`,
  editStronger: (percent) => `Rinne d’eagarthóireacht na dathanna ${percent}% níos láidre ná an bunleagan.`,
  editWeaker: (percent) => `Rinne d’eagarthóireacht na dathanna ${percent}% níos boige ná an bunleagan.`,
  fixSoften: 'Maolaigh an dath',
  fixCooler: 'Déan níos fuaire',
  fixWarmer: 'Déan níos teo',
  fixApplied: 'Déanta. Is féidir leat é a chealú ó stair na heagarthóireachta.',
  findings: (count) => plural(count, { one: `${count} rud le seiceáil`, other: `${count} rud le seiceáil` }),
};
