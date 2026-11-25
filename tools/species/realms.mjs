/**
 * Countries to the app's species regions (src/core/speciesRegions.ts: PAL NA SA AF OR AU, and PO for Pacific islands),
 * for name lists that record where a species lives by country rather than by realm. A country that spans two realms
 * (China, Mexico, Indonesia) gives both, so a species is never dropped from a region it may occur in.
 */
const REALMS = {
  PAL: 'AD AL AM AT AX AZ BA BE BG BY CH CY CZ DE DK DZ EE EG ES FI FO FR GB GE GG GI GR HR HU IE IL IM IQ IR IS IT JE JO JP KG KP KR KW KZ LB LI LT LU LV LY MA MC MD ME MK MN MT NL NO PL PS PT QA RO RS RU SA SE SI SJ SK SM SY TJ TM TN TR UA UZ VA XK AE BH OM YE AF PK CN EH MR',
  NA: 'US CA GL PM BM MX',
  SA: 'MX GT BZ SV HN NI CR PA CO VE GY SR GF EC PE BR BO PY CL AR UY FK GS CU JM HT DO PR BS TC KY VG VI AI AG KN MS GP DM MQ LC VC BB GD TT AW CW BQ SX MF BL',
  AF: 'SN GM GW GN SL LR CI ML BF GH TG BJ NE NG TD SD SS CM CF GQ GA CG CD AO ET ER DJ SO KE UG RW BI TZ MZ MW ZM ZW BW NA ZA LS SZ MG MU RE YT KM SC ST CV SH YE OM SA MR EH',
  OR: 'IN PK NP BT BD LK MV MM TH LA KH VN MY SG BN ID PH TW CN HK MO TL IO',
  AU: 'AU NZ PG ID TL SB NC VU NF',
  PO: 'FJ WS TO TV KI NR MH FM PW MP GU AS CK NU PF PN TK WF UM',
};

const byCountry = new Map();
for (const [realm, codes] of Object.entries(REALMS)) {
  for (const code of codes.split(/\s+/)) {
    if (!byCountry.has(code)) byCountry.set(code, new Set());
    byCountry.get(code).add(realm);
  }
}

/** The species regions for a list of ISO 3166-1 alpha-2 country codes. Unknown codes add nothing. */
export function realmsForCountries(codes) {
  const out = new Set();
  for (const code of codes) for (const realm of byCountry.get(String(code).trim().toUpperCase()) ?? []) out.add(realm);
  return [...out].sort();
}

/** Every ISO code with its English name, plus common short forms, for reading free-text distributions. */
const ALIASES = {
  US: ['USA', 'United States', 'U.S.A.'], GB: ['UK', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales'],
  RU: ['Russia'], CD: ['Democratic Republic of the Congo', 'DR Congo', 'Zaire', 'Congo (Kinshasa)'], CG: ['Republic of the Congo', 'Congo (Brazzaville)'],
  CI: ['Ivory Coast', "Cote d'Ivoire", "Côte d'Ivoire"], KR: ['South Korea', 'Korea'], KP: ['North Korea'], LA: ['Laos'], VN: ['Vietnam'],
  SY: ['Syria'], IR: ['Iran'], TZ: ['Tanzania'], BO: ['Bolivia'], VE: ['Venezuela'], MD: ['Moldova'], MK: ['North Macedonia', 'Macedonia'],
  CZ: ['Czech Republic', 'Czechia'], MM: ['Myanmar', 'Burma'], TL: ['East Timor', 'Timor-Leste'], SZ: ['Swaziland', 'Eswatini'],
  CV: ['Cape Verde'], FM: ['Micronesia'], PS: ['Palestine'], TW: ['Taiwan'], BN: ['Brunei'], GF: ['French Guiana'], PG: ['Papua New Guinea', 'New Guinea'],
  SB: ['Solomon Islands'], NC: ['New Caledonia'], PR: ['Puerto Rico'], DO: ['Dominican Republic', 'Hispaniola'], BS: ['Bahamas'], MG: ['Madagascar'],
};
export function countryMatchers() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const list = [];
  for (const code of byCountry.keys()) {
    const found = new Set([names.of(code), ...(ALIASES[code] ?? [])].filter(Boolean));
    for (const name of found) list.push({ code, pattern: new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`, 'i') });
  }
  // Longer names first, so "Papua New Guinea" is found before "Guinea".
  return list.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

/** ISO codes named in free text ("N China (W Xinjiang), Kyrgyzstan, NE Uzbekistan"). */
export function countriesInText(text, matchers = countryMatchers()) {
  const found = new Set();
  let rest = ` ${text} `;
  for (const { code, pattern } of matchers) {
    if (pattern.test(rest)) { found.add(code); rest = rest.replace(pattern, ' '); }
  }
  return [...found];
}
