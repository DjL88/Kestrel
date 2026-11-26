import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  menu: (n: number) => `Unisci ${n} foto in HDR`,
  menuHint: "Combina una serie di foto più scure e più chiare in una nuova foto a 16 bit che conserva luci e ombre. Gli originali non vengono modificati.",
  task: (n: number) => `Unione HDR di ${n} foto`,
  reading: "Lettura delle foto",
  aligning: "Allineamento delle foto",
  merging: "Unione delle esposizioni",
  saving: "Aggiunta della foto HDR",
  done: (name: string, n: number) => `Aggiunta ${name}, unita da ${n} foto. Le sue foto originali restano intatte.`,
  cancelled: "Unione HDR interrotta. Non è stato aggiunto nulla. Le sue foto originali restano intatte.",
  failed: "L'unione HDR non è terminata. Apra Attività per conoscere il motivo. Le sue foto originali restano intatte.",
  tooFew: "Scelga almeno due foto della stessa scena, scattate più scure e più chiare, per unirle in HDR. Le sue foto originali restano intatte.",
  tooMany: (max: number) => `Scelga al massimo ${max} foto alla volta da unire in HDR. Le sue foto originali restano intatte.`,
  sizeMismatch: "Queste foto hanno dimensioni diverse, quindi non si possono allineare. Le sue foto originali restano intatte.",
  sameExposure: "Queste foto sembrano avere la stessa esposizione, quindi non c'è nulla da unire. Scelga una serie scattata più scura e più chiara. Le sue foto originali restano intatte.",
  unrelated: (n: number) => `La foto ${n} non si allinea con le altre in modo abbastanza chiaro, quindi non è stato unito nulla invece di tirare a indovinare. Scelga immagini di una stessa serie. Le sue foto originali restano intatte.`,
  unsupported: (name: string) => `${name} non può essere letta a piena risoluzione qui, quindi non è stato unito nulla. Non è stata usata un'immagine più piccola al suo posto. Le sue foto originali restano intatte.`,
  rawNotDeveloped: (name: string) => `${name} non è stata sviluppata a 16 bit dai dati del sensore qui, e la piccola anteprima incorporata della fotocamera non viene usata per l'HDR. Ricolleghi l'originale e riprovi. Le sue foto originali restano intatte.`,
  tooLarge: "Queste foto sono troppo grandi per essere unite in sicurezza su questo dispositivo. Non è stato unito nulla. Le sue foto originali restano intatte.",
  ghostsRemoved: "Qualcosa si è mosso tra una foto e l'altra. Lì l'unione usa una sola foto, così nulla appare due volte.",
  highlightsClipped: "Alcune luci erano troppo chiare anche nella foto più scura, quindi restano bianche.",
  mainThread: "È stato eseguito in primo piano perché qui il lavoro in background non è disponibile, quindi l'app potrebbe essersi fermata a tratti.",
  infoTitle: "Unione HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Creata da ${n} foto:`, other: `Creata da ${n} foto:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stop`,
  infoHow: "Ogni parte viene dalle foto ben esposte in quel punto, allineate e pesate in base all'esposizione, poi regolate con Luci e Ombre dell'editor. Nessun pixel è stato generato.",
  whatIs: "HDR significa ampia gamma dinamica, non alta definizione. Unisce più esposizioni della stessa scena così che cieli luminosi e ombre scure conservino entrambi i dettagli.",
  bracketTitle: "Serie di esposizioni",
  bracketFound: (n: number, stops: string) => `${n} foto scattate a pochi istanti di distanza con esposizioni diverse (${stops} stop).`,
  bracketFromCamera: "La sua fotocamera ha segnato queste foto come una serie di esposizioni.",
  bracketFromExposures: "Trovate in base a tempo di scatto, diaframma e ISO.",
};
