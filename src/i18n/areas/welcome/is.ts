import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  welcome: {
    title: "Velkomin í InFlight",
    intro: "Þrennt sem gott er að vita áður en þú byrjar:",
    originals: "Upprunalegu myndirnar þínar eru áfram þar sem þær eru. InFlight breytir þeim aldrei, færir þær eða skiptir þeim út.",
    undo: "Allar breytingar má afturkalla. InFlight geymir uppskrift að breytingunum þínum, ekki nýtt afrit af myndinni.",
    backup: "Öryggisafrit verkefnis geymir val þitt, einkunnir og breytingar, en ekki RAW-skrárnar sjálfar. Taktu líka afrit af upprunalegu myndunum.",
    webNote: "Í vafra biður InFlight vafrann um að halda geymslunni sinni þegar þú heldur áfram. Hvað það þýðir sérðu í Stillingum, undir Geymsla.",
    done: "Skilið",
  },
  browserStorage: {
    title: "Geymsla þessa vafra",
    checking: "Athuga hvað þessi vafri geymir…",
    standard: "Þessi vafri getur eytt geymslu InFlight þegar pláss klárast eða þegar gögnum vefsvæðisins er eytt.",
    requesting: "Bið vafrann um að halda geymslu InFlight…",
    persistent: "Þessi vafri hefur samþykkt að halda geymslu InFlight. Ef gögnum vefsvæðisins er eytt handvirkt hverfur hún samt.",
    declined: "Vafrinn samþykkti ekki að halda geymslu InFlight. Hann ákveður það sjálfur, oft eftir því hve mikið þú notar vefinn. Þú getur beðið aftur seinna.",
    unavailable: "Þessi vafri getur ekki lofað að halda geymslu InFlight.",
    ask: "Biðja vafrann um að halda geymslunni",
    kept: "Geymslunni er haldið",
    permissionsTitle: "Skráaheimildir",
    permissions: "Vafrinn leyfir InFlight aðeins að lesa myndirnar og möppurnar sem þú velur. Eftir að þú lokar flipanum eða endurræsir getur hann spurt aftur áður en InFlight sér möppu. Að segja nei skaðar ekki myndirnar þínar; InFlight getur bara ekki sýnt þær fyrr en þú leyfir það.",
    forgetTitle: "Það sem vafrinn getur gleymt",
    forget: "Verkefnin þín, val, breytingar og forskoðanir eru geymd í þessum vafra. Að hreinsa vafragögn, nota einkaglugga eða fjarlægja vafrann getur eytt þeim. Upprunalegu myndirnar þínar eru aldrei geymdar eða þeim breytt hér, svo þær eru öruggar.",
    backupHint: "Til öryggis skaltu taka öryggisafrit úr valkostum verkefnisins og geyma það, ásamt upprunalegu myndunum, utan þessa vafra.",
  },
  diskPreviews: {
    title: "Forskoðanir í þessari tölvu",
    intro: "InFlight geymir þrjár litlar myndir af hverri RAW-mynd í eigin möppu: smámynd, skoðunarafrit og snjalla forskoðun í 2560 px. Þú getur haldið áfram að breyta mynd þegar drifið hennar er ekki tengt. Útflutningur þarf samt frumritið. Frumritunum þínum er aldrei breytt.",
    using: "{used} í notkun fyrir {count} myndir.",
    checking: "Athuga möppuna með forskoðunum…",
    limitLabel: "Hámarksstærð",
    limitDefault: "{size} (mælt með fyrir þessa tölvu)",
    limitHint: "Um {count} myndir komast fyrir. Þegar mappan fyllist eru þær forskoðanir fjarlægðar sem þú hefur ekki skoðað lengst. Þær eru gerðar aftur þegar þú opnar myndirnar með drifið tengt.",
    clear: "Fjarlægja allar forskoðanir",
    cleared: "Forskoðanir fjarlægðar. Þær eru gerðar aftur þegar þú skoðar myndir.",
    failed: "Ekki tókst að lesa möppuna með forskoðunum.",
  },
};
