import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  menu: (n: number) => `Yhdistä ${n} kuvaa HDR-kuvaksi`,
  menuHint: "Yhdistää sarjan tummempia ja vaaleampia kuvia uudeksi 16-bittiseksi kuvaksi, joka säilyttää valoalueet ja varjot. Alkuperäisiä ei muuteta.",
  task: (n: number) => `Yhdistetään ${n} kuvaa HDR-kuvaksi`,
  reading: "Luetaan kuvia",
  aligning: "Kohdistetaan kuvia",
  merging: "Yhdistetään valotuksia",
  saving: "Lisätään HDR-kuva",
  done: (name: string, n: number) => `${name} lisättiin, yhdistetty ${n} kuvasta. Alkuperäiset kuvasi ovat koskemattomia.`,
  cancelled: "HDR-yhdistäminen pysäytettiin. Mitään ei lisätty. Alkuperäiset kuvasi ovat koskemattomia.",
  failed: "HDR-yhdistäminen ei valmistunut. Katso syy kohdasta Tehtävät. Alkuperäiset kuvasi ovat koskemattomia.",
  tooFew: "Valitse vähintään kaksi kuvaa samasta näkymästä, tummempana ja vaaleampana otettuina, HDR-yhdistämistä varten. Alkuperäiset kuvasi ovat koskemattomia.",
  tooMany: (max: number) => `Valitse enintään ${max} kuvaa kerrallaan HDR-yhdistämiseen. Alkuperäiset kuvasi ovat koskemattomia.`,
  sizeMismatch: "Kuvat ovat erikokoisia, joten niitä ei voi kohdistaa. Alkuperäiset kuvasi ovat koskemattomia.",
  sameExposure: "Kuvilla näyttää olevan sama valotus, joten yhdistettävää ei ole. Valitse sarja, joka on otettu tummempana ja vaaleampana. Alkuperäiset kuvasi ovat koskemattomia.",
  unrelated: (n: number) => `Kuvaa ${n} ei voi kohdistaa muihin riittävän selvästi, joten mitään ei yhdistetty arvaamisen sijaan. Valitse kuvat yhdestä sarjasta. Alkuperäiset kuvasi ovat koskemattomia.`,
  unsupported: (name: string) => `Kuvaa ${name} ei voi lukea täysikokoisena täällä, joten mitään ei yhdistetty. Pienempää kuvaa ei käytetty tilalla. Alkuperäiset kuvasi ovat koskemattomia.`,
  rawNotDeveloped: (name: string) => `Kuvaa ${name} ei voitu kehittää 16-bittisenä kennon tiedoista täällä, eikä kameran pientä upotettua esikatselua käytetä HDR:ään. Yhdistä alkuperäinen uudelleen ja yritä uudestaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  tooLarge: "Kuvat ovat liian suuria yhdistettäviksi turvallisesti tällä laitteella. Mitään ei yhdistetty. Alkuperäiset kuvasi ovat koskemattomia.",
  ghostsRemoved: "Jokin liikkui kuvien välillä. Niissä kohdissa yhdistäminen käyttää vain yhtä kuvaa, joten mitään ei näy kahdesti.",
  highlightsClipped: "Osa valoalueista oli liian kirkkaita jopa tummimmassa kuvassa, joten ne jäävät valkoisiksi.",
  mainThread: "Se ajettiin etualalla, koska taustatyö ei ole täällä käytettävissä, joten sovellus saattoi välillä pysähtyä.",
  infoTitle: "HDR-yhdistäminen",
  infoMadeFrom: (n: number) => plural(n, { one: `Tehty ${n} kuvasta:`, other: `Tehty ${n} kuvasta:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} aukkoa`,
  infoHow: "Jokainen kohta tulee kuvista, jotka olivat siinä hyvin valotettuja, kohdistettuina ja valotuksen mukaan painotettuina, ja sitten säädettyinä editorin Valoalueet- ja Varjot-säätimillä. Pikseleitä ei luotu.",
};
