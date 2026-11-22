import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. Colour names sit in brackets or after a colon so they keep their base form. */
export const gd: AreaTranslation<typeof source> = {
  title: 'Sgrùdadh dhathan',
  intro: 'Bheir InFlight ainm air na dathan san dealbh seo agus innsidh e dhut, ann am faclan, mu rud sam bith a dh’fhaodadh a bhith ceàrr.',
  checking: 'A’ sgrùdadh an datha…',
  unavailable: 'Chan eil an sgrùdadh dhathan ri fhaighinn airson an deilbh seo fhathast.',
  mainColours: 'Prìomh dhathan',
  nothingToFix: 'Chan eil coltas gu bheil dad ceàrr air an dath san ro-shealladh bheag seo.',
  watchOut: 'An aire:',
  tip: 'Moladh:',
  note: 'Nòta:',
  family: {
    red: 'dearg', orange: 'orains', brown: 'donn', yellow: 'buidhe', lime: 'buidhe-uaine', green: 'uaine', teal: 'gorm-uaine',
    blue: 'gorm', purple: 'purpaidh', pink: 'pinc', grey: 'liath', black: 'dubh', white: 'geal',
  },
  strength: { none: 'gun dath', muted: 'bog', moderate: 'meadhanach', strong: 'làidir', veryStrong: 'glè làidir' },
  share: (percent) => (percent >= 45 ? 'mu leth no barrachd' : percent >= 25 ? 'mu chairteal no barrachd' : percent >= 10 ? 'pàirt mhath' : 'beagan'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} agus ${second}`,
  strongColour: (colours, percent) => `Tha dath glè làidir (${colours}) a’ còmhdachadh ${percent}% den dealbh. Dh’fhaodadh e coimhead mì-nàdarrach air sgrìn agus clò-bhualadh gu dona.`,
  clippedColour: (colours) => `Tha cuid de raointean (${colours}) ro làidir airson am mion-fhiosrachadh a shealltainn, agus mar sin tha iad a’ coimhead rèidh.`,
  cast: {
    warm: 'Tha rudan a bu chòir a bhith liath no geal a’ coimhead beagan buidhe no orains (fiamh blàth).',
    cool: 'Tha rudan a bu chòir a bhith liath no geal a’ coimhead beagan gorm (fiamh fuar).',
    green: 'Tha rudan a bu chòir a bhith liath no geal a’ coimhead beagan uaine.',
    magenta: 'Tha rudan a bu chòir a bhith liath no geal a’ coimhead beagan pinc no purpaidh.',
  },
  castClear: 'Tha am fiamh soilleir gu leòr gum mothaich a’ mhòr-chuid de dhaoine dha.',
  muted: 'Is gann gu bheil dath sam bith san dealbh seo. Tha sin ceart gu leòr ma tha thu ga iarraidh cha mhòr dubh is geal.',
  redGreen: (first, second) => `Tha na raointean (${first} agus ${second}) cha mhòr cho soilleir ri chèile, agus mar sin bidh e doirbh do mhòran dhaoine a tha dath-dhall an aithneachadh bho chèile.`,
  redGreenHint: 'Ma nì thu tè dhiubh nas soilleire no nas dorcha, chì a h-uile duine an diofar nas fheàrr.',
  subject: (subjectColour, strength, surroundings) => `An cuspair agad: ${subjectColour}, ${strength}. Mun cuairt: ${surroundings} sa mhòr-chuid.`,
  editStronger: (percent) => `Rinn an deasachadh agad na dathan ${percent}% nas làidire na an tionndadh tùsail.`,
  editWeaker: (percent) => `Rinn an deasachadh agad na dathan ${percent}% nas buige na an tionndadh tùsail.`,
  fixSoften: 'Bogaich an dath',
  fixCooler: 'Dèan nas fhuaire',
  fixWarmer: 'Dèan nas blàithe',
  fixApplied: 'Deiseil. Is urrainn dhut a neo-dhèanamh o eachdraidh nan deasachaidhean.',
  findings: (count) => plural(count, { one: `${count} rud ri sgrùdadh`, other: `${count} rud ri sgrùdadh` }),
};
