/**
 * Photography words and how each language should render them, for the wording audit's context report.
 *
 * `expected` holds lower-case stems of the photographic word the app has chosen for that language (taken from the
 * app's own canonical labels, such as the Exposure slider and the Masks heading), so any phrase that uses a different
 * word is listed for a reviewer. Celtic stems drop the first letter where mutation changes it (Welsh "cyfres",
 * "gyfres" → "yfres").
 *
 * `wrong` holds stems of the dictionary meaning that is a definite mistake in a photo app (a goalkeeper for "keeper",
 * an explosion for "burst", loud din for "noise"). Only words we are sure of are listed: a `wrong` hit fails the audit.
 *
 * `question` records a doubt for a native speaker without failing anything. These lists are drafts, not a native review.
 */
export const PHOTO_TERMS = {
  exposure: {
    source: /\bexpos(?:ure|ures|ed|e)\b/i,
    languages: {
      fr: { expected: ['expos', 'surexpos', 'sous-expos'] },
      es: { expected: ['expos', 'sobreexpu', 'subexpu'] },
      it: { expected: ['espos', 'sovraespo', 'sottoespo'] },
      pt: { expected: ['expos', 'sobreexpo', 'subexpo'] },
      de: { expected: ['belicht'], wrong: ['exposition'], why: 'Exposition means an exhibition or a summary, not the light in a photo' },
      nl: { expected: ['belicht'], wrong: ['expositie', 'tentoonstelling'], why: 'expositie means an exhibition' },
      da: { expected: ['ekspon', 'belys'] },
      sv: { expected: ['expon'] },
      nb: { expected: ['ekspon'] },
      fi: { expected: ['valot'] },
      is: { expected: ['lýs'] },
      cy: { expected: ['atguddi'] },
      gd: { expected: ['nochd'] },
      ga: { expected: ['nocht'] },
    },
  },
  mask: {
    source: /\bmask(?:s|ed|ing)?\b/i,
    languages: {
      fr: { expected: ['masqu'] }, es: { expected: ['máscar', 'mascar', 'enmascar'] }, it: { expected: ['masch'] },
      pt: { expected: ['máscar', 'mascar'] }, de: { expected: ['mask'] }, nl: { expected: ['masker'] },
      da: { expected: ['mask'] }, sv: { expected: ['mask'] }, nb: { expected: ['mask'] }, fi: { expected: ['mask'] },
      is: { expected: ['grím', 'grim'] }, cy: { expected: ['masg', 'fasg'] }, gd: { expected: ['masg', 'mhasg'] },
      ga: { expected: ['masc', 'maisc', 'mhasc', 'mhaisc'] },
    },
  },
  noise: {
    source: /\b(?:noise|noisy|denoise|denoising)\b/i,
    languages: {
      fr: { expected: ['bruit', 'débruit'] }, es: { expected: ['ruido'] }, it: { expected: ['rumore'] },
      pt: { expected: ['ruído', 'ruido'] },
      de: { expected: ['rausch', 'entrausch'], wrong: ['lärm'], why: 'Lärm is loud noise you hear' },
      nl: { expected: ['ruis'], wrong: ['lawaai'], why: 'lawaai is loud noise you hear' },
      da: { expected: ['støj'] }, sv: { expected: ['brus'], wrong: ['oväsen', 'buller'], why: 'oväsen and buller are sounds you hear' },
      nb: { expected: ['støy'] }, fi: { expected: ['kohin'], wrong: ['melu'], why: 'melu is loud noise you hear' },
      is: { expected: ['suð', 'suðeyð'], wrong: ['hávaða', 'hávaði'], why: 'hávaði is loud noise you hear' },
      cy: { expected: ['sŵn', 'swn'], question: 'sŵn is the everyday word for sound; a native check should confirm it reads as image noise (or suggest grawn)' },
      gd: { expected: ['gràinne', 'ghràinne'], wrong: ['fuaim'], why: 'fuaim is sound you hear; the editor already says gràinne (grain) for noise in a photo' },
      ga: { expected: ['torann', 'torainn'], question: 'torann is loud noise; a native check should confirm a word for speckle in a photo' },
    },
  },
  burst: {
    source: /\bbursts?\b/i,
    languages: {
      fr: { expected: ['rafale'], wrong: ['éclatement', 'explosion'], why: 'éclatement is something bursting open' },
      es: { expected: ['ráfaga', 'rafaga'], wrong: ['estallido', 'explosión'], why: 'estallido is an explosion' },
      it: { expected: ['raffic'], wrong: ['scoppio', 'esplosion'], why: 'scoppio is an explosion' },
      pt: { expected: ['sequência', 'sequencia', 'rajada'], wrong: ['explosão', 'estouro'], why: 'estouro is an explosion' },
      de: { expected: ['serie'], wrong: ['platzen', 'ausbruch', 'explosion'], why: 'Ausbruch is an outbreak or eruption' },
      nl: { expected: ['reeks', 'serie'], wrong: ['uitbarsting', 'barsten'], why: 'uitbarsting is an eruption' },
      da: { expected: ['serie'], wrong: ['udbrud'], why: 'udbrud is an outbreak' },
      sv: { expected: ['serie'], wrong: ['utbrott'], why: 'utbrott is an outbreak' },
      nb: { expected: ['serie'], wrong: ['utbrudd'], why: 'utbrudd is an outbreak' },
      fi: { expected: ['sarja'], wrong: ['purkau', 'räjäh'], why: 'purkaus and räjähdys are eruptions and explosions' },
      is: { expected: ['hrin', 'hrun', 'röð', 'rað'], wrong: ['sprenging'], why: 'sprenging is an explosion' },
      cy: { expected: ['yfres'] }, gd: { expected: ['reath'] }, ga: { expected: ['raith'] },
    },
  },
  keeper: {
    source: /\bkeepers?\b/i,
    languages: {
      fr: { expected: ['garder', 'conserv'], wrong: ['gardien'], why: 'gardien is a goalkeeper or caretaker' },
      es: { expected: ['conserv', 'guardar'], wrong: ['portero', 'arquero'], why: 'portero is a goalkeeper' },
      it: { expected: ['tenere', 'tenut', 'conserv'], wrong: ['portiere'], why: 'portiere is a goalkeeper' },
      pt: { expected: ['manter', 'mantid', 'guardar'], wrong: ['goleiro', 'guarda-redes'], why: 'goleiro is a goalkeeper' },
      de: { expected: ['behalt', 'behält'], wrong: ['torwart', 'torhüter'], why: 'Torwart is a goalkeeper' },
      nl: { expected: ['bewa', 'houden'], wrong: ['keeper', 'doelman'], why: 'keeper is a goalkeeper in Dutch' },
      da: { expected: ['behold', 'udvalg'], wrong: ['målmand'], why: 'målmand is a goalkeeper' },
      sv: { expected: ['behåll', 'utvald'], wrong: ['målvakt'], why: 'målvakt is a goalkeeper' },
      nb: { expected: ['behold', 'utvalg'], wrong: ['keeper', 'målvakt'], why: 'keeper is a goalkeeper in Norwegian' },
      fi: { expected: ['säily'], wrong: ['maalivah'], why: 'maalivahti is a goalkeeper' },
      is: { expected: ['halda', 'held', 'haldi', 'vald', 'völd'], wrong: ['markvörð', 'markmað'], why: 'markvörður is a goalkeeper' },
      cy: { expected: ['cadw', 'gadw', 'nghadw'] }, gd: { expected: ['cumail', 'chumail', 'gleidh'] },
      ga: { expected: ['coinne', 'choinne'] },
    },
  },
  flag: {
    source: /\b(?:un)?flag(?:s|ged|ging)?\b/i,
    languages: {
      fr: { expected: ['marqu', 'drapeau'] }, es: { expected: ['marc', 'marq'] }, it: { expected: ['contrassegn', 'segn'] },
      pt: { expected: ['marc', 'marq'] }, de: { expected: ['markier'] }, nl: { expected: ['marker', 'markeer'] },
      da: { expected: ['marker', 'markér'] }, sv: { expected: ['flagg', 'marker'] }, nb: { expected: ['merk', 'marker'] },
      fi: { expected: ['merki', 'merkk'] }, is: { expected: ['merk'] }, cy: { expected: ['marc', 'farc'] },
      gd: { expected: ['comharr', 'chomharr'] }, ga: { expected: ['marc', 'mharc'] },
    },
  },
  pick: {
    // "Picks" as the photos chosen in a cull. The verb ("pick a folder", "picks up a tint") is everyday "choose".
    source: /\bpicks\b(?! up\b)/i,
    languages: {
      fr: { expected: ['choi', 'sélection'] }, es: { expected: ['eleg', 'elig', 'selecc'] },
      it: { expected: ['scelt', 'scegl', 'selezion'] }, pt: { expected: ['escolh', 'selec'] },
      de: { expected: ['auswahl', 'ausgewählt', 'auswähl', 'favorit'], wrong: ['spitzhacke'], why: 'Spitzhacke is a pickaxe' },
      nl: { expected: ['keuze', 'gekozen', 'selectie', 'kies'] }, da: { expected: ['valg', 'valgt', 'vælg'] },
      sv: { expected: ['val', 'välj'] }, nb: { expected: ['valg', 'valgt', 'velg'] }, fi: { expected: ['valin', 'valit'] },
      is: { expected: ['val'] }, cy: { expected: ['dewis', 'ddewis'] }, gd: { expected: ['roghainn', 'tagh'] },
      ga: { expected: ['rogha', 'roghn'] },
    },
  },
};
