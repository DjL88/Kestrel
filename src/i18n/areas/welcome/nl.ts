import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  welcome: {
    title: "Welkom bij InFlight",
    intro: "Drie dingen om te weten voordat u begint:",
    originals: "Uw originele foto's blijven waar ze zijn. InFlight wijzigt, verplaatst of vervangt ze nooit.",
    undo: "Elke bewerking kan ongedaan worden gemaakt. InFlight bewaart een recept van uw wijzigingen, geen nieuwe kopie van de foto.",
    backup: "Een projectback-up bewaart uw keuzes, beoordelingen en bewerkingen, maar niet de RAW-bestanden zelf. Maak ook een back-up van uw originelen.",
    webNote: "In een webbrowser vraagt InFlight de browser om zijn opslag te bewaren wanneer u verdergaat. Wat dat betekent, leest u in Instellingen, onder Opslag.",
    done: "Begrepen",
  },
  browserStorage: {
    title: "Opslag van deze browser",
    checking: "Controleren wat deze browser bewaart…",
    standard: "Deze browser kan de opslag van InFlight wissen als de ruimte opraakt of sitegegevens worden gewist.",
    requesting: "De browser vragen de opslag van InFlight te bewaren…",
    persistent: "Deze browser heeft ingestemd de opslag van InFlight te bewaren. Als u zelf sitegegevens wist, wordt die toch verwijderd.",
    declined: "De browser heeft niet ingestemd de opslag van InFlight te bewaren. Dat beslist hij zelf, vaak op basis van hoeveel u de site gebruikt. U kunt het later opnieuw vragen.",
    unavailable: "Deze browser kan niet beloven de opslag van InFlight te bewaren.",
    ask: "De browser vragen de opslag te bewaren",
    kept: "Opslag wordt bewaard",
    permissionsTitle: "Bestandsrechten",
    permissions: "De browser laat InFlight alleen de foto's en mappen lezen die u kiest. Na het sluiten van het tabblad of een herstart kan hij het opnieuw vragen voordat InFlight een map kan zien. Nee zeggen schaadt uw foto's niet; InFlight kan ze alleen niet tonen totdat u het toestaat.",
    forgetTitle: "Wat de browser kan vergeten",
    forget: "Uw projecten, keuzes, bewerkingen en voorbeelden staan in deze browser. Browsegegevens wissen, een privévenster gebruiken of de browser verwijderen kan ze weghalen. Uw originele foto's worden hier nooit opgeslagen of gewijzigd, dus die zijn veilig.",
    backupHint: "Maak voor de zekerheid een projectback-up via de projectopties en bewaar die, samen met uw originelen, buiten deze browser.",
  },
};
