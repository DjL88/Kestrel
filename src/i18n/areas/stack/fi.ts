import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  menu: (n: number) => `Tarkennuspinoa ${n} kuvaa`,
  menuHint: "Yhdistää kunkin kuvan terävimmät kohdat uudeksi kuvaksi. Alkuperäisiä ei muuteta.",
  task: (n: number) => `Tarkennuspinotaan ${n} kuvaa`,
  reading: "Luetaan kuvia",
  aligning: "Kohdistetaan kuvia",
  blending: "Yhdistetään terävimmät kohdat",
  saving: "Lisätään pinottu kuva",
  done: (name: string, n: number) => `${name} lisättiin, pinottu ${n} kuvasta. Alkuperäiset kuvasi ovat koskemattomia.`,
  cancelled: "Tarkennuspinoaminen pysäytettiin. Mitään ei lisätty. Alkuperäiset kuvasi ovat koskemattomia.",
  failed: "Tarkennuspinoaminen ei valmistunut. Katso syy kohdasta Tehtävät. Alkuperäiset kuvasi ovat koskemattomia.",
  tooFew: "Valitse vähintään kaksi kuvaa samasta näkymästä. Alkuperäiset kuvasi ovat koskemattomia.",
  tooMany: (max: number) => `Valitse enintään ${max} kuvaa kerrallaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  sizeMismatch: "Kuvat ovat erikokoisia, joten niitä ei voi kohdistaa. Alkuperäiset kuvasi ovat koskemattomia.",
  unrelated: (n: number) => `Kuva ${n} ei näytä samalta näkymältä kuin naapurinsa, joten mitään ei pinottu. Valitse kuvat samasta sarjasta. Alkuperäiset kuvasi ovat koskemattomia.`,
  ambiguous: (n: number) => `On epäselvää, miten kuva ${n} asettuu naapuriinsa (kuvio toistuu tai se liikkui liikaa), joten mitään ei pinottu arvaamisen sijaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  tooFlat: (n: number) => `Kuvassa ${n} on liian vähän yksityiskohtia kohdistukseen, joten mitään ei pinottu arvaamisen sijaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  unsupported: (name: string) => `Kuvaa ${name} ei voi lukea täysikokoisena täällä, joten mitään ei pinottu. Pienempää kuvaa ei käytetty tilalla. Alkuperäiset kuvasi ovat koskemattomia.`,
  rawNotDeveloped: (name: string) => `Kuvalla ${name} ei ole vielä täysikokoista kehitystä kennon tiedoista, eikä kameran pientä upotettua esikatselua käytetä. Tee ensin täysikokoinen kehitys. Alkuperäiset kuvasi ovat koskemattomia.`,
  tooLarge: "Kuvat ovat liian suuria pinottaviksi turvallisesti tällä laitteella. Mitään ei pinottu. Alkuperäiset kuvasi ovat koskemattomia.",
  equallySharp: "Kuvat näyttävät yhtä teräviltä kaikkialla, joten pino voi näyttää hyvin samalta kuin alkuperäiset.",
  frameUnused: (n: number) => `Kuva ${n} toi pinoon tuskin mitään.`,
  oneFrameDominates: "Yksi kuva antoi lähes kaikki yksityiskohdat. Tarkista, että kuvat otettiin eri tarkennusetäisyyksiltä.",
  localFallback: (n: number) => `Kuva ${n} kohdistettiin vain kokonaisuutena: vastaavia yksityiskohtia oli liian vähän tarkempaan kohdistukseen.`,
  mainThread: "Se ajettiin etualalla, koska taustatyö ei ole täällä käytettävissä, joten sovellus saattoi välillä pysähtyä.",
  infoTitle: "Tarkennuspino",
  infoMadeFrom: (n: number) => plural(n, { one: `Tehty ${n} kuvasta:`, other: `Tehty ${n} kuvasta:` }),
  infoHow: "Jokainen kohta tulee siinä kohdassa terävimmästä kuvasta, pehmeästi yhdistettynä. Pikseleitä ei luotu.",
};
