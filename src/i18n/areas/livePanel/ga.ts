import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  open: `Grianghrafadóireacht bheo`,
  openHint: `Tosaigh grianghrafadóireacht bheo: tagann na grianghraif isteach sa tionscadal seo de réir mar a ghlacann tú iad.`,
  title: `Grianghrafadóireacht bheo`,
  intro: `Tagann na grianghraif isteach sa tionscadal seo de réir mar a ghlacann tú iad. Ní athraítear aon rud ar an gceamara ná san fhillteán. Níor tástáladh fós le fíorcheamara.`,
  source: `Cá as a dtagann na grianghraif`,
  folder: `Fillteán`,
  folderHint: `Sábhálann aip cheangail nó ríomhchlár eile grianghraif i bhfillteán a roghnaíonn tú.`,
  ftpHint: `Seolann an ceamara gach grianghraf chuig an ríomhaire seo thar an líonra áitiúil.`,
  usbHint: `Réamhamharc: níor triaileadh é ach le ceamara ionsamhlaithe go dtí seo.`,
  look: `Cuma do na chéad ghrianghraif eile`,
  lookNone: `Dada: tagann grianghraif mar a glacadh iad`,
  lookNote: `Faigheann gach grianghraf nua an chuma seo mar a eagarthóireacht féin. Baineann Cumaí › Dada nó Athshocraigh í. Ní athraítear an bunchomhad riamh.`,
  room: `Taispeáin ar scáileáin eile ar an líonra seo`,
  roomNote: `Is féidir le táibléad cliaint nó scáileán stiúideo na grianghraif a fheiceáil agus réaltaí agus roghanna a chur leo. Bíonn do mharcanna féin i gcónaí chun tosaigh.`,
  start: `Tosaigh grianghrafadóireacht bheo`,
  stop: `Stop grianghrafadóireacht bheo`,
  close: `Dún agus stop`,
  closeNote: `Má dhúnann tú an painéal seo stopann an ghrianghrafadóireacht bheo agus múchtar bosca isteach an cheamara agus an seomra.`,
  running: (n: number) => plural(n, { one: `Grianghrafadóireacht bheo ar siúl · ${n} ghrianghraf go dtí seo`, other: `Grianghrafadóireacht bheo ar siúl · ${n} grianghraf go dtí seo` }),
  lookOn: (name: string) => `Cuma do na chéad ghrianghraif eile: ${name}`,
  ftpSame: `Fanann siad seo mar an gcéanna gach uair ar an ríomhaire seo, mar sin coinníonn an ceamara a shocruithe.`,
  portChanged: (port: number) => `Bhí an gnáthphort in úsáid, mar sin úsáideann an seisiún seo port ${port}. Clóscríobh ar an gceamara é, nó dún an ríomhchlár eile agus tosaigh arís.`,
  newPassword: `Déan pasfhocal nua`,
  newPasswordNote: `Ansin clóscríobh an pasfhocal nua ar an gceamara.`,
  roomHeading: `Oscail an seoladh seo ar an scáileán eile`,
  starting: `Ag tosú…`,
};
