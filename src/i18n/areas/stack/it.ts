import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  menu: (n: number) => `Focus stacking di ${n} foto`,
  menuHint: "Unisce le parti più nitide di ogni foto in una nuova foto. Gli originali non vengono modificati.",
  task: (n: number) => `Focus stacking di ${n} foto`,
  reading: "Lettura delle foto",
  aligning: "Allineamento delle foto",
  blending: "Fusione delle parti più nitide",
  saving: "Aggiunta della foto unita",
  done: (name: string, n: number) => `Aggiunta ${name}, unita da ${n} foto. Le sue foto originali restano intatte.`,
  cancelled: "Focus stacking interrotto. Non è stato aggiunto nulla. Le sue foto originali restano intatte.",
  failed: "Il focus stacking non è terminato. Apra Attività per conoscere il motivo. Le sue foto originali restano intatte.",
  tooFew: "Scelga almeno due foto della stessa scena. Le sue foto originali restano intatte.",
  tooMany: (max: number) => `Scelga al massimo ${max} foto alla volta. Le sue foto originali restano intatte.`,
  sizeMismatch: "Queste foto hanno dimensioni diverse, quindi non si possono allineare. Le sue foto originali restano intatte.",
  unrelated: (n: number) => `La foto ${n} non sembra la stessa scena della vicina, quindi non è stato unito nulla. Scelga fotogrammi della stessa raffica. Le sue foto originali restano intatte.`,
  ambiguous: (n: number) => `Non è chiaro come la foto ${n} si allinei alla vicina (il motivo si ripete o si è mossa troppo), quindi non è stato unito nulla invece di tirare a indovinare. Le sue foto originali restano intatte.`,
  tooFlat: (n: number) => `La foto ${n} ha troppo pochi dettagli per essere allineata, quindi non è stato unito nulla invece di tirare a indovinare. Le sue foto originali restano intatte.`,
  unsupported: (name: string) => `${name} non può essere letta a piena risoluzione qui, quindi non è stato unito nulla. Non è stata usata un'immagine più piccola al suo posto. Le sue foto originali restano intatte.`,
  rawNotDeveloped: (name: string) => `${name} non ha ancora uno sviluppo a piena risoluzione dai dati del sensore, e la piccola anteprima incorporata della fotocamera non viene usata. Esegua prima lo sviluppo a piena risoluzione. Le sue foto originali restano intatte.`,
  tooLarge: "Queste foto sono troppo grandi per essere unite in sicurezza su questo dispositivo. Non è stato unito nulla. Le sue foto originali restano intatte.",
  equallySharp: "Queste foto sembrano ugualmente nitide ovunque, quindi il risultato potrebbe somigliare molto agli originali.",
  frameUnused: (n: number) => `La foto ${n} non ha aggiunto quasi nulla.`,
  oneFrameDominates: "Una sola foto ha fornito quasi tutto il dettaglio. Verifichi che le foto siano state scattate a distanze di messa a fuoco diverse.",
  localFallback: (n: number) => `La foto ${n} è stata allineata solo nel complesso: aveva troppi pochi dettagli corrispondenti per un allineamento più fine.`,
  mainThread: "È stato eseguito in primo piano perché qui il lavoro in background non è disponibile, quindi l'app potrebbe essersi fermata a tratti.",
  infoTitle: "Focus stacking",
  infoMadeFrom: (n: number) => plural(n, { one: `Creata da ${n} foto:`, other: `Creata da ${n} foto:` }),
  infoHow: "Ogni parte proviene dalla foto più nitida in quel punto, fusa con morbidezza. Nessun pixel è stato generato.",
};
