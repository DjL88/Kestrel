import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  welcome: {
    title: "Croeso i InFlight",
    intro: "Tri pheth sy'n werth eu gwybod cyn dechrau:",
    originals: "Mae eich lluniau gwreiddiol yn aros lle maen nhw. Nid yw InFlight byth yn eu newid, eu symud na'u disodli.",
    undo: "Gellir dadwneud pob golygiad. Mae InFlight yn cadw rysáit o'ch newidiadau, nid copi newydd o'r llun.",
    backup: "Mae copi wrth gefn o brosiect yn cadw eich penderfyniadau, sgorau a golygiadau, ond nid y ffeiliau RAW eu hunain. Cadwch gopi wrth gefn o'ch rhai gwreiddiol hefyd.",
    done: "Iawn",
  },
  browserStorage: {
    title: "Storfa'r porwr hwn",
    checking: "Yn gwirio beth mae'r porwr hwn yn ei gadw…",
    standard: "Gall y porwr hwn glirio storfa InFlight pan fydd lle'n brin neu pan fydd data'r wefan yn cael ei glirio.",
    requesting: "Yn gofyn i'r porwr gadw storfa InFlight…",
    persistent: "Mae'r porwr hwn wedi cytuno i gadw storfa InFlight. Os byddwch chi'n clirio data'r wefan eich hun, caiff ei dileu er hynny.",
    declined: "Ni chytunodd y porwr i gadw storfa InFlight. Mae'n penderfynu hyn ei hun, yn aml yn ôl faint rydych yn defnyddio'r wefan. Gallwch ofyn eto'n nes ymlaen.",
    unavailable: "Ni all y porwr hwn addo cadw storfa InFlight.",
    ask: "Gofyn i'r porwr gadw'r storfa",
    kept: "Mae'r storfa'n cael ei chadw",
    permissionsTitle: "Caniatâd ffeiliau",
    permissions: "Dim ond y lluniau a'r ffolderi rydych yn eu dewis y mae'r porwr yn gadael i InFlight eu darllen. Ar ôl cau'r tab neu ailgychwyn, efallai y bydd yn gofyn eto cyn i InFlight weld ffolder. Nid yw dweud na yn niweidio eich lluniau; ni all InFlight eu dangos nes i chi ganiatáu.",
    forgetTitle: "Beth all y porwr ei anghofio",
    forget: "Mae eich prosiectau, penderfyniadau, golygiadau a rhagolygon yn cael eu cadw yn y porwr hwn. Gall clirio data pori, defnyddio ffenestr breifat neu ddadosod y porwr eu dileu. Nid yw eich lluniau gwreiddiol byth yn cael eu storio na'u newid yma, felly maen nhw'n ddiogel.",
    backupHint: "I fod yn ddiogel, gwnewch gopi wrth gefn o'r prosiect o'i opsiynau a'i gadw, gyda'ch rhai gwreiddiol, yn rhywle y tu allan i'r porwr hwn.",
  },
  diskPreviews: {
    title: "Rhagolygon ar y cyfrifiadur hwn",
    intro: "Mae InFlight yn cadw tri llun bach o bob llun RAW yn ei ffolder ei hun: llun bach, copi i’w adolygu a rhagolwg clyfar 2,560 px. Gallwch chi barhau i olygu llun pan nad yw ei yriant wedi’i gysylltu. Mae allforio yn dal i fod angen y gwreiddiol. Nid yw eich lluniau gwreiddiol byth yn cael eu newid.",
    using: "Yn defnyddio {used} ar gyfer {count} llun.",
    checking: "Yn gwirio’r ffolder rhagolygon…",
    limitLabel: "Terfyn maint",
    limitDefault: "{size} (awgrymir ar gyfer y cyfrifiadur hwn)",
    limitHint: "Mae lle i tua {count} llun. Pan fydd y ffolder yn llawn, caiff y rhagolygon nad ydych wedi edrych arnyn nhw ers hiraf eu tynnu. Cânt eu gwneud eto pan fyddwch chi’n agor y lluniau hynny gyda’u gyriant wedi’i gysylltu.",
    clear: "Tynnu pob rhagolwg",
    cleared: "Rhagolygon wedi’u tynnu. Cânt eu gwneud eto wrth i chi edrych ar luniau.",
    failed: "Nid oedd modd darllen y ffolder rhagolygon.",
  },
};
