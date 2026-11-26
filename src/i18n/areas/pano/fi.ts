import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  menu: (n: number) => `Yhdistä ${n} kuvaa panoraamaksi`,
  menuHint: "Yhdistää päällekkäiset kuvat yhdeksi uudeksi leveäksi kuvaksi, rajattuna oikeisiin pikseleihin. Alkuperäisiä ei muuteta.",
  task: (n: number) => `Yhdistetään panoraamaa ${n} kuvasta`,
  reading: "Luetaan kuvia",
  matching: "Etsitään kuvien päällekkäisiä kohtia",
  placing: "Sijoitetaan kuvia",
  blending: "Häivytetään saumoja",
  saving: "Lisätään panoraamaa",
  done: (name: string, n: number) => `${name} lisättiin, yhdistetty ${n} kuvasta. Alkuperäiset kuvasi ovat koskemattomia.`,
  cropNote: (percent: number) => `Rajattu niihin ${percent} %:iin yhdistetystä alueesta, jotka oikeat pikselit peittävät. Mitään ei täytetty.`,
  cancelled: "Yhdistäminen pysäytettiin. Mitään ei lisätty. Alkuperäiset kuvasi ovat koskemattomia.",
  failed: "Panoraama ei valmistunut. Avaa Tehtävät nähdäksesi syyn. Alkuperäiset kuvasi ovat koskemattomia.",
  tooFew: "Valitse vähintään kaksi päällekkäistä kuvaa. Alkuperäiset kuvasi ovat koskemattomia.",
  tooMany: (max: number) => `Valitse enintään ${max} kuvaa kerrallaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  sizeMismatch: "Kuvat ovat erikokoisia, joten niitä ei yhdistetty. Alkuperäiset kuvasi ovat koskemattomia.",
  tooFlat: (n: number) => `Kuvassa ${n} on liian vähän yksityiskohtia kohdistamiseen, joten mitään ei yhdistetty arvaamisen sijaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  unrelated: (n: number) => `Kuva ${n} ei ole tarpeeksi päällekkäin edellisen kanssa kohdistamista varten, joten mitään ei yhdistetty. Valitse kuvat ottojärjestyksessä niin, että kukin peittää seuraavasta noin kolmanneksen. Alkuperäiset kuvasi ovat koskemattomia.`,
  ambiguous: (n: number) => `On epäselvää, missä kuva ${n} liittyy edelliseen. Kuvio toistuu tai kamera kallistui liikaa, joten mitään ei yhdistetty arvaamisen sijaan. Alkuperäiset kuvasi ovat koskemattomia.`,
  vertical: "Kuvat kulkevat ylhäältä alas eivätkä sivusuunnassa. Pystypanoraamoja ei vielä tueta, joten mitään ei yhdistetty. Alkuperäiset kuvasi ovat koskemattomia.",
  tooLarge: "Panoraama olisi liian suuri tehtäväksi turvallisesti tällä laitteella, eikä sitä pienennetä kysymättä. Valitse vähemmän kuvia. Alkuperäiset kuvasi ovat koskemattomia.",
  noCoverage: "Kuvista ei jää suorakulmiota, jonka oikeat pikselit peittävät, joten mitään ei yhdistetty aukkojen täyttämisen sijaan. Alkuperäiset kuvasi ovat koskemattomia.",
  unsupported: (name: string) => `Kuvaa ${name} ei voi lukea täysikokoisena täällä, joten mitään ei yhdistetty. Pienempää kuvaa ei käytetty tilalla. Alkuperäiset kuvasi ovat koskemattomia.`,
  rawNotDeveloped: (name: string) => `Kuvalla ${name} ei ole vielä täysikokoista kehitystä kennon tiedoista, eikä kameran pientä upotettua esikatselua käytetä panoraamoihin. Tee ensin täysikokoinen kehitys. Alkuperäiset kuvasi ovat koskemattomia.`,
  exposureDiffers: "Kuvat otettiin melko eri kirkkaudella. Ne tasattiin, mutta tarkista, näkyykö taivaalla raitoja.",
  seamsVisible: "Jotkin saumat voivat näkyä: jokin liikkui kuvien välillä, tai kamera siirtyi kääntymisen sijaan.",
  focalEstimated: "Objektiivin polttoväliä ei ollut tallennettu, joten se laskettiin kuvista.",
  mainThread: "Se ajettiin etualalla, koska taustatyö ei ole täällä käytettävissä, joten sovellus saattoi välillä pysähtyä.",
  infoTitle: "Panoraama",
  infoMadeFrom: (n: number) => plural(n, { one: `Yhdistetty ${n} kuvasta:`, other: `Yhdistetty ${n} kuvasta:` }),
  infoHow: "Sijoitettu sylinterille, saumat häivytetty pehmeästi ja rajattu oikeisiin pikseleihin. Pikseleitä ei luotu.",
};
