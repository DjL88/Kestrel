import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  welcome: {
    title: "Välkommen till InFlight",
    intro: "Tre saker som är bra att veta innan du börjar:",
    originals: "Dina originalfoton ligger kvar där de är. InFlight ändrar, flyttar eller ersätter dem aldrig.",
    undo: "Varje redigering kan ångras. InFlight sparar ett recept på dina ändringar, inte en ny kopia av fotot.",
    backup: "En projektsäkerhetskopia sparar dina val, betyg och redigeringar, men inte själva RAW-filerna. Säkerhetskopiera även dina original.",
    webNote: "I en webbläsare ber InFlight webbläsaren att behålla sin lagring när du fortsätter. Vad det innebär står i Inställningar, under Lagring.",
    done: "Jag förstår",
  },
  browserStorage: {
    title: "Den här webbläsarens lagring",
    checking: "Kontrollerar vad den här webbläsaren behåller …",
    standard: "Den här webbläsaren kan rensa InFlights lagring när utrymmet tar slut eller när webbplatsdata rensas.",
    requesting: "Ber webbläsaren att behålla InFlights lagring …",
    persistent: "Den här webbläsaren har gått med på att behålla InFlights lagring. Om du själv rensar webbplatsdata tas den ändå bort.",
    declined: "Webbläsaren gick inte med på att behålla InFlights lagring. Det avgör den själv, ofta efter hur mycket du använder sidan. Du kan fråga igen senare.",
    unavailable: "Den här webbläsaren kan inte lova att behålla InFlights lagring.",
    ask: "Be webbläsaren att behålla lagringen",
    kept: "Lagringen behålls",
    permissionsTitle: "Filbehörigheter",
    permissions: "Webbläsaren låter InFlight läsa bara de foton och mappar du väljer. När du har stängt fliken eller startat om kan den fråga igen innan InFlight kan se en mapp. Att säga nej skadar inte dina foton; InFlight kan bara inte visa dem förrän du tillåter det.",
    forgetTitle: "Vad webbläsaren kan glömma",
    forget: "Dina projekt, val, redigeringar och förhandsvisningar finns i den här webbläsaren. Att rensa webbinformation, använda ett privat fönster eller avinstallera webbläsaren kan ta bort dem. Dina originalfoton lagras eller ändras aldrig här, så de är säkra.",
    backupHint: "Gör för säkerhets skull en projektsäkerhetskopia från projektets alternativ och spara den, tillsammans med dina original, utanför den här webbläsaren.",
  },
  diskPreviews: {
    title: "Förhandsvisningar på den här datorn",
    intro: "InFlight sparar tre små bilder av varje RAW-foto i en egen mapp: en miniatyr, en granskningskopia och en smart förhandsvisning på 2 560 px. Du kan fortsätta redigera ett foto när dess enhet inte är ansluten. Export kräver fortfarande originalet. Dina original ändras aldrig.",
    using: "{used} används för {count} foton.",
    checking: "Kontrollerar mappen med förhandsvisningar …",
    limitLabel: "Största storlek",
    limitDefault: "{size} (föreslås för den här datorn)",
    limitHint: "Ungefär {count} foton får plats. När mappen är full tas de förhandsvisningar bort som du inte har tittat på längst. De görs igen när du öppnar fotona med enheten ansluten.",
    clear: "Ta bort alla förhandsvisningar",
    cleared: "Förhandsvisningarna är borttagna. De görs igen när du tittar på foton.",
    failed: "Mappen med förhandsvisningar kunde inte läsas.",
  },
};
