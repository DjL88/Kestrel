import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  open: `Bein myndataka`,
  openHint: `Byrjaðu beina myndatöku: myndir berast í þetta verkefni um leið og þú tekur þær.`,
  title: `Bein myndataka`,
  intro: `Myndir berast í þetta verkefni um leið og þú tekur þær. Engu er breytt á myndavélinni eða í möppunni. Ekki enn prófað með raunverulegri myndavél.`,
  source: `Hvaðan myndirnar koma`,
  folder: `Mappa`,
  folderHint: `Tengiforrit eða annað forrit vistar myndir í möppu sem þú velur.`,
  ftpHint: `Myndavélin sendir hverja mynd í þessa tölvu yfir staðarnetið.`,
  usbHint: `Forskoðun: aðeins prófað með hermdri myndavél enn sem komið er.`,
  look: `Útlit fyrir næstu myndir`,
  lookNone: `Ekkert: myndir berast eins og þær voru teknar`,
  lookNote: `Hver ný mynd fær þetta útlit sem eigin breytingu. Útlit › Ekkert eða Endurstilla fjarlægir það. Upprunalegu skránni er aldrei breytt.`,
  room: `Sýna á öðrum skjám á þessu neti`,
  roomNote: `Spjaldtölva viðskiptavinar eða skjár í stúdíói getur séð myndirnar og gefið stjörnur og val. Þínar eigin merkingar gilda alltaf.`,
  start: `Byrja beina myndatöku`,
  stop: `Stöðva beina myndatöku`,
  close: `Loka og stöðva`,
  closeNote: `Þegar þú lokar þessum glugga stöðvast bein myndataka og slökkt er á innhólfi myndavélarinnar og herberginu.`,
  running: (n: number) => plural(n, { one: `Bein myndataka í gangi · ${n} mynd hingað til`, other: `Bein myndataka í gangi · ${n} myndir hingað til` }),
  lookOn: (name: string) => `Útlit fyrir næstu myndir: ${name}`,
  ftpSame: `Þetta helst eins í hvert skipti í þessari tölvu, svo myndavélin heldur stillingum sínum.`,
  portChanged: (port: number) => `Venjulega gáttin var í notkun, svo þessi myndataka notar gátt ${port}. Skrifaðu hana í myndavélina, eða lokaðu hinu forritinu og byrjaðu aftur.`,
  newPassword: `Búa til nýtt lykilorð`,
  newPasswordNote: `Skrifaðu svo nýja lykilorðið í myndavélina.`,
  roomHeading: `Opnaðu þetta vistfang á hinum skjánum`,
  starting: `Ræsi…`,
};
