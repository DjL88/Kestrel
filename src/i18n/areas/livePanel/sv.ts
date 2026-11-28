import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  open: `Livefotografering`,
  openHint: `Starta en livefotografering: bilderna kommer in i projektet medan du fotograferar.`,
  title: `Livefotografering`,
  intro: `Bilderna kommer in i projektet medan du fotograferar. Inget ändras i kameran eller i mappen. Ännu inte testat med en riktig kamera.`,
  source: `Var bilderna kommer ifrån`,
  folder: `En mapp`,
  folderHint: `En tether-app eller ett annat program sparar bilder i en mapp du väljer.`,
  ftpHint: `Kameran skickar varje bild till den här datorn över det lokala nätverket.`,
  usbHint: `En förhandsfunktion: hittills bara provad med en simulerad kamera.`,
  look: `Look för nästa bilder`,
  lookNone: `Ingen: bilderna kommer som de togs`,
  lookNote: `Varje ny bild får den här looken som sin egen redigering. Looks › Ingen eller Återställ tar bort den. Originalfilen ändras aldrig.`,
  room: `Visa på andra skärmar i det här nätverket`,
  roomNote: `En kunds surfplatta eller en studioskärm kan se bilderna och ge stjärnor och val. Dina egna markeringar gäller alltid.`,
  start: `Starta livefotografering`,
  stop: `Stoppa livefotografering`,
  close: `Stäng och stoppa`,
  closeNote: `När du stänger panelen stoppas livefotograferingen och kamerainkorgen och rummet stängs av.`,
  running: (n: number) => plural(n, { one: `Livefotografering pågår · ${n} bild hittills`, other: `Livefotografering pågår · ${n} bilder hittills` }),
  lookOn: (name: string) => `Look för nästa bilder: ${name}`,
  ftpSame: `De är desamma varje gång på den här datorn, så kameran behåller sina inställningar.`,
  portChanged: (port: number) => `Den vanliga porten var upptagen, så den här fotograferingen använder port ${port}. Skriv in den i kameran, eller stäng det andra programmet och börja om.`,
  newPassword: `Skapa ett nytt lösenord`,
  newPasswordNote: `Skriv sedan in det nya lösenordet i kameran.`,
  roomHeading: `Öppna den här adressen på den andra skärmen`,
  starting: `Startar…`,
};
