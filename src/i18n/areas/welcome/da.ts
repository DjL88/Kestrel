import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  welcome: {
    title: "Velkommen til InFlight",
    intro: "Tre ting, der er værd at vide, før du går i gang:",
    originals: "Dine originale fotos bliver, hvor de er. InFlight ændrer, flytter eller erstatter dem aldrig.",
    undo: "Alle redigeringer kan fortrydes. InFlight gemmer en opskrift på dine ændringer, ikke en ny kopi af fotoet.",
    backup: "En projektbackup gemmer dine valg, vurderinger og redigeringer, men ikke selve RAW-filerne. Tag også backup af dine originaler.",
    done: "Forstået",
  },
  browserStorage: {
    title: "Denne browsers lager",
    checking: "Tjekker, hvad denne browser beholder …",
    standard: "Denne browser kan slette InFlights lager, når pladsen slipper op, eller når webstedsdata ryddes.",
    requesting: "Beder browseren om at beholde InFlights lager …",
    persistent: "Denne browser har sagt ja til at beholde InFlights lager. Rydder du selv webstedsdata, fjernes det alligevel.",
    declined: "Browseren sagde ikke ja til at beholde InFlights lager. Det afgør den selv, ofte ud fra hvor meget du bruger siden. Du kan spørge igen senere.",
    unavailable: "Denne browser kan ikke love at beholde InFlights lager.",
    ask: "Bed browseren om at beholde lageret",
    kept: "Lageret beholdes",
    permissionsTitle: "Filtilladelser",
    permissions: "Browseren lader kun InFlight læse de fotos og mapper, du vælger. Når du har lukket fanen eller genstartet, spørger den måske igen, før InFlight kan se en mappe. Et nej skader ikke dine fotos; InFlight kan bare ikke vise dem, før du tillader det.",
    forgetTitle: "Hvad browseren kan glemme",
    forget: "Dine projekter, valg, redigeringer og forhåndsvisninger ligger i denne browser. Rydning af browserdata, et privat vindue eller afinstallation af browseren kan fjerne dem. Dine originale fotos gemmes eller ændres aldrig her, så de er sikre.",
    backupHint: "For en sikkerheds skyld: lav en projektbackup fra projektets indstillinger, og gem den sammen med dine originaler et sted uden for denne browser.",
  },
  diskPreviews: {
    title: "Forhåndsvisninger på denne computer",
    intro: "InFlight gemmer tre små billeder af hvert RAW-foto i sin egen mappe: et miniaturebillede, en visningskopi og en smart forhåndsvisning på 2.560 px. Du kan blive ved med at redigere et foto, når dets drev ikke er tilsluttet. Eksport kræver stadig originalen. Dine originaler bliver aldrig ændret.",
    using: "{used} brugt til {count} fotos.",
    checking: "Tjekker mappen med forhåndsvisninger …",
    limitLabel: "Største størrelse",
    limitDefault: "{size} (anbefalet til denne computer)",
    limitHint: "Der er plads til cirka {count} fotos. Når mappen er fuld, fjernes de forhåndsvisninger, du ikke har set på i længst tid. De laves igen, når du åbner fotoene med deres drev tilsluttet.",
    clear: "Fjern alle forhåndsvisninger",
    cleared: "Forhåndsvisninger fjernet. De laves igen, når du ser på fotos.",
    failed: "Mappen med forhåndsvisninger kunne ikke læses.",
  },
};
