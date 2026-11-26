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
    webNote: "In un browser web, quando prosegue InFlight chiederà al browser di conservare il suo spazio di archiviazione. Il significato è spiegato in Impostazioni, alla voce Archiviazione.",
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
};
