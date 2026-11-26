import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  welcome: {
    title: "Velkommen til InFlight",
    intro: "Tre ting som er greit å vite før du starter:",
    originals: "Originalbildene dine blir der de er. InFlight endrer, flytter eller erstatter dem aldri.",
    undo: "Alle redigeringer kan angres. InFlight lagrer en oppskrift på endringene dine, ikke en ny kopi av bildet.",
    backup: "En prosjektsikkerhetskopi tar vare på valgene, vurderingene og redigeringene dine, men ikke selve RAW-filene. Ta også sikkerhetskopi av originalene.",
    webNote: "I en nettleser ber InFlight nettleseren om å beholde lagringen sin når du fortsetter. Hva det betyr, står i Innstillinger under Lagring.",
    done: "Skjønner",
  },
  browserStorage: {
    title: "Lagringen i denne nettleseren",
    checking: "Sjekker hva denne nettleseren beholder …",
    standard: "Denne nettleseren kan slette InFlights lagring når plassen blir liten eller når nettstedsdata slettes.",
    requesting: "Ber nettleseren om å beholde InFlights lagring …",
    persistent: "Denne nettleseren har sagt ja til å beholde InFlights lagring. Sletter du nettstedsdata selv, blir den likevel fjernet.",
    declined: "Nettleseren sa ikke ja til å beholde InFlights lagring. Det bestemmer den selv, ofte ut fra hvor mye du bruker siden. Du kan spørre igjen senere.",
    unavailable: "Denne nettleseren kan ikke love å beholde InFlights lagring.",
    ask: "Be nettleseren om å beholde lagringen",
    kept: "Lagringen beholdes",
    permissionsTitle: "Filtillatelser",
    permissions: "Nettleseren lar InFlight lese bare bildene og mappene du velger. Når du har lukket fanen eller startet på nytt, kan den spørre igjen før InFlight kan se en mappe. Et nei skader ikke bildene dine; InFlight kan bare ikke vise dem før du tillater det.",
    forgetTitle: "Hva nettleseren kan glemme",
    forget: "Prosjektene, valgene, redigeringene og forhåndsvisningene dine ligger i denne nettleseren. Å slette nettleserdata, bruke et privat vindu eller avinstallere nettleseren kan fjerne dem. Originalbildene dine lagres eller endres aldri her, så de er trygge.",
    backupHint: "For sikkerhets skyld: lag en prosjektsikkerhetskopi fra prosjektets alternativer, og oppbevar den sammen med originalene et sted utenfor denne nettleseren.",
  },
  diskPreviews: {
    title: "Forhåndsvisninger på denne datamaskinen",
    intro: "InFlight lagrer tre små bilder av hvert RAW-bilde i sin egen mappe: et miniatyrbilde, en visningskopi og en smart forhåndsvisning på 2560 px. Du kan fortsette å redigere et bilde når stasjonen ikke er koblet til. Eksport trenger fortsatt originalen. Originalene dine endres aldri.",
    using: "{used} brukt til {count} bilder.",
    checking: "Sjekker mappen med forhåndsvisninger …",
    limitLabel: "Største størrelse",
    limitDefault: "{size} (foreslått for denne datamaskinen)",
    limitHint: "Det er plass til omtrent {count} bilder. Når mappen er full, fjernes forhåndsvisningene du ikke har sett på lengst. De lages på nytt når du åpner bildene med stasjonen koblet til.",
    clear: "Fjern alle forhåndsvisninger",
    cleared: "Forhåndsvisningene er fjernet. De lages på nytt når du ser på bilder.",
    failed: "Mappen med forhåndsvisninger kunne ikke leses.",
  },
};
