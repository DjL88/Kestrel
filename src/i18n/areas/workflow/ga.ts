import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  title: "Amhairc shábháilte",
  hint: "Coinnítear ar an ngléas seo amháin iad. Athraíonn amharc na grianghraif a thaispeántar, ní na grianghraif féin.",
  none: "Níl aon amharc sábháilte fós. Roghnaigh scagairí, ansin sábháil anseo iad le hainm.",
  show: (name: string) => `Taispeáin ${name}`,
  remove: (name: string) => `Scrios an t-amharc sábháilte ${name}`,
  nameLabel: "Ainm do na scagairí seo",
  save: "Sábháil an t-amharc",
  saved: (name: string) => `Sábháladh an t-amharc ${name}.`,
  replaced: (name: string) => `Nuashonraíodh an t-amharc ${name}.`,
  emptyName: "Clóscríobh ainm don amharc ar dtús.",
  full: (max: number) => `Is féidir suas le ${max} amharc a choinneáil. Scrios ceann ar dtús.`,
  notStored: "Níor choinnigh an gléas seo an t-amharc, mar sin beidh sé imithe nuair a dhúnfar InFlight.",
  showing: (name: string) => `An t-amharc sábháilte ${name} á thaispeáint`,
  noneAhead: "Níl a thuilleadh grianghraf le hathbhreithniú i ndiaidh an cheann seo sna grianghraif a thaispeántar.",
  noneBehind: "Níl aon ghrianghraf le hathbhreithniú roimh an gceann seo sna grianghraif a thaispeántar.",
};
