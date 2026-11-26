import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  menu: (n: number) => `Unisci ${n} foto in un panorama`,
  menuHint: "Unisce foto che si sovrappongono in una nuova foto larga, ritagliata sui soli pixel reali. Gli originali non vengono modificati.",
  task: (n: number) => `Unione di un panorama da ${n} foto`,
  reading: "Lettura delle foto",
  matching: "Ricerca delle sovrapposizioni",
  placing: "Posizionamento delle foto",
  blending: "Fusione delle giunture",
  saving: "Aggiunta del panorama",
  done: (name: string, n: number) => `Aggiunta ${name}, unita da ${n} foto. Le sue foto originali restano intatte.`,
  cropNote: (percent: number) => `Ritagliata al ${percent}% dell'area unita coperta da pixel reali. Non è stato riempito nulla.`,
  cancelled: "Unione interrotta. Non è stato aggiunto nulla. Le sue foto originali restano intatte.",
  failed: "Il panorama non è stato completato. Apra Attività per il motivo. Le sue foto originali restano intatte.",
  tooFew: "Scelga almeno due foto che si sovrappongono. Le sue foto originali restano intatte.",
  tooMany: (max: number) => `Scelga al massimo ${max} foto alla volta. Le sue foto originali restano intatte.`,
  sizeMismatch: "Queste foto hanno dimensioni diverse, quindi non sono state unite. Le sue foto originali restano intatte.",
  tooFlat: (n: number) => `La foto ${n} ha troppo pochi dettagli per essere allineata, quindi non è stato unito nulla invece di tirare a indovinare. Le sue foto originali restano intatte.`,
  unrelated: (n: number) => `La foto ${n} non si sovrappone abbastanza alla precedente per allinearle, quindi non è stato unito nulla. Scelga le foto nell'ordine di scatto, ognuna sovrapposta alla successiva per circa un terzo. Le sue foto originali restano intatte.`,
  ambiguous: (n: number) => `Non è chiaro dove la foto ${n} si unisce alla precedente. Il motivo si ripete, o la fotocamera era troppo inclinata, quindi non è stato unito nulla invece di tirare a indovinare. Le sue foto originali restano intatte.`,
  vertical: "Queste foto vanno dall'alto in basso invece che di lato. I panorami verticali non sono ancora supportati, quindi non è stato unito nulla. Le sue foto originali restano intatte.",
  tooLarge: "Questo panorama sarebbe troppo grande da creare in sicurezza su questo dispositivo, e non viene ridotto senza chiedere. Scelga meno foto. Le sue foto originali restano intatte.",
  noCoverage: "Le foto non lasciano un rettangolo coperto da pixel reali, quindi non è stato unito nulla invece di riempire i vuoti. Le sue foto originali restano intatte.",
  unsupported: (name: string) => `${name} non può essere letta a piena risoluzione qui, quindi non è stato unito nulla. Non è stata usata un'immagine più piccola al suo posto. Le sue foto originali restano intatte.`,
  rawNotDeveloped: (name: string) => `${name} non ha ancora uno sviluppo a piena risoluzione dai dati del sensore, e la piccola anteprima incorporata della fotocamera non viene usata per i panorami. Esegua prima lo sviluppo a piena risoluzione. Le sue foto originali restano intatte.`,
  exposureDiffers: "Le foto sono state scattate con luminosità piuttosto diverse. Sono state uniformate, ma controlli se nel cielo ci sono bande.",
  seamsVisible: "Alcune giunture potrebbero vedersi: qualcosa si è mosso tra una foto e l'altra, o la fotocamera si è spostata invece di ruotare.",
  focalEstimated: "La lunghezza focale dell'obiettivo non era registrata, quindi è stata ricavata dalle foto.",
  mainThread: "È stato eseguito in primo piano perché qui il lavoro in background non è disponibile, quindi l'app potrebbe essersi fermata a tratti.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Unita da ${n} foto:`, other: `Unita da ${n} foto:` }),
  infoHow: "Disposte su un cilindro, giunture fuse dolcemente e ritagliata sui pixel reali. Non è stato generato alcun pixel.",
};
