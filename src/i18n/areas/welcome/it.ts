import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  welcome: {
    title: "Benvenuto in InFlight",
    intro: "Tre cose da sapere prima di iniziare:",
    originals: "Le Sue foto originali restano dove sono. InFlight non le modifica, non le sposta e non le sostituisce mai.",
    undo: "Ogni modifica si può annullare. InFlight conserva una ricetta delle Sue modifiche, non una nuova copia della foto.",
    backup: "Un backup del progetto conserva scelte, valutazioni e modifiche, ma non i file RAW. Faccia anche un backup degli originali.",
    done: "Ho capito",
  },
  browserStorage: {
    title: "Archiviazione di questo browser",
    checking: "Verifica di cosa conserva questo browser…",
    standard: "Questo browser può cancellare l'archiviazione di InFlight quando lo spazio scarseggia o quando si cancellano i dati del sito.",
    requesting: "Richiesta al browser di conservare l'archiviazione di InFlight…",
    persistent: "Questo browser ha accettato di conservare l'archiviazione di InFlight. Se cancella Lei i dati del sito, viene comunque rimossa.",
    declined: "Il browser non ha accettato di conservare l'archiviazione di InFlight. Lo decide da solo, spesso in base a quanto usa il sito. Può chiederlo di nuovo più tardi.",
    unavailable: "Questo browser non può garantire di conservare l'archiviazione di InFlight.",
    ask: "Chiedi al browser di conservare l'archiviazione",
    kept: "L'archiviazione è conservata",
    permissionsTitle: "Permessi dei file",
    permissions: "Il browser permette a InFlight di leggere solo le foto e le cartelle che sceglie. Dopo aver chiuso la scheda o riavviato, potrebbe chiedere di nuovo il permesso prima che InFlight veda una cartella. Rispondere di no non danneggia le foto; InFlight non può solo mostrarle finché non lo consente.",
    forgetTitle: "Cosa può dimenticare il browser",
    forget: "Progetti, scelte, modifiche e anteprime sono conservati in questo browser. Cancellare i dati di navigazione, usare una finestra privata o disinstallare il browser può eliminarli. Le foto originali non vengono mai salvate né modificate qui, quindi sono al sicuro.",
    backupHint: "Per sicurezza, faccia un backup dalle opzioni del progetto e lo conservi, insieme agli originali, fuori da questo browser.",
  },
  diskPreviews: {
    title: "Anteprime su questo computer",
    intro: "InFlight tiene tre piccole immagini di ogni foto RAW nella sua cartella: una miniatura, una copia di revisione e un’anteprima avanzata da 2560 px. Può continuare a modificare una foto con il disco scollegato. Per esportare serve sempre l’originale. I suoi originali non vengono mai modificati.",
    using: "{used} in uso per {count} foto.",
    checking: "Controllo della cartella delle anteprime…",
    limitLabel: "Dimensione massima",
    limitDefault: "{size} (consigliata per questo computer)",
    limitHint: "Ci stanno circa {count} foto. Quando la cartella è piena, vengono tolte le anteprime che non guarda da più tempo. Vengono rifatte quando riapre quelle foto con il disco collegato.",
    clear: "Togli tutte le anteprime",
    cleared: "Anteprime tolte. Vengono rifatte mentre guarda le foto.",
    failed: "Non è stato possibile leggere la cartella delle anteprime.",
  },
};
