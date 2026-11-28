import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  open: `Scatto in diretta`,
  openHint: `Avvii uno scatto in diretta: le foto arrivano in questo progetto mentre scatta.`,
  title: `Scatto in diretta`,
  intro: `Le foto arrivano in questo progetto mentre scatta. Nulla viene modificato sulla fotocamera o nella cartella. Non ancora provato con una fotocamera reale.`,
  source: `Da dove arrivano le foto`,
  folder: `Una cartella`,
  folderHint: `Un'app di tethering o un altro programma salva le foto in una cartella che sceglie Lei.`,
  ftpHint: `La fotocamera invia ogni foto a questo computer tramite la rete locale.`,
  usbHint: `Un'anteprima: finora provata solo con una fotocamera simulata.`,
  look: `Stile per i prossimi scatti`,
  lookNone: `Nessuno: le foto arrivano come scattate`,
  lookNote: `Ogni nuova foto riceve questo stile come modifica propria. Stili › Nessuno o Ripristina lo toglie. Il file originale non viene mai modificato.`,
  room: `Mostra su altri schermi di questa rete`,
  roomNote: `Il tablet di un cliente o uno schermo dello studio può vedere le foto e aggiungere stelle e scelte. I Suoi contrassegni prevalgono sempre.`,
  start: `Avvia scatto in diretta`,
  stop: `Interrompi scatto in diretta`,
  close: `Chiudi e interrompi`,
  closeNote: `Chiudere questo pannello interrompe lo scatto in diretta e spegne l'arrivo dalla fotocamera e la sala.`,
  running: (n: number) => plural(n, { one: `Scatto in diretta in corso · ${n} foto finora`, other: `Scatto in diretta in corso · ${n} foto finora` }),
  lookOn: (name: string) => `Stile per i prossimi scatti: ${name}`,
  ftpSame: `Restano uguali ogni volta su questo computer, così la fotocamera mantiene le sue impostazioni.`,
  portChanged: (port: number) => `La porta abituale era occupata, quindi questo scatto usa la porta ${port}. La inserisca nella fotocamera, oppure chiuda l'altro programma e ricominci.`,
  newPassword: `Crea una nuova password`,
  newPasswordNote: `Poi inserisca la nuova password nella fotocamera.`,
  roomHeading: `Apra questo indirizzo sull'altro schermo`,
  starting: `Avvio…`,
};
