import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  size: `Vientikoko`,
  standard: (w: number, h: number) => `Vakio · ${w} × ${h} px`,
  double: (w: number, h: number) => `Kaksinkertainen koko · ${w} × ${h} px`,
  custom: `Oma pitkä sivu`,
  customEdge: `Pitkä sivu pikseleinä`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Tulostustarkkuus`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF kuvalaboratoriolle, ${dpi} PPI, 3 mm leikkuuvara ja rajauslaatikot. Ei CMYK eikä sertifioitu PDF/X.`,
  windows: `Kuvat kussakin ikkunassa`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Sivu ${page}, tausta: ${filename}` : `Sivu ${page}, ikkuna ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `Kuvassa ${sw} × ${sh} px, näytetään kokoon ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Näytetään kokoon ${ww} × ${wh} px. Kuvan koko tarkistetaan, kun kollaasi viedään.`,
  enlarged: (percent: number) => `Suurennettu ${percent} %:iin, joten se näyttää pehmeämmältä.`,
  sharp: `Riittävästi pikseleitä tähän kokoon.`,
  ppi: (ppi: number) => `${ppi} pikseliä tuumalla.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pikseliä tuumalla, alle valitun ${dpi} DPI:n, joten tuloste on pehmeämpi.`,
  lowSummary: (n: number) => plural(n, { one: `${n} ikkunassa on vähemmän pikseleitä kuin tämä koko vaatii. Valitse pienempi koko tai vie silti, jolloin se näyttää pehmeämmältä.`, other: `${n} ikkunassa on vähemmän pikseleitä kuin tämä koko vaatii. Valitse pienempi koko tai vie silti, jolloin ne näyttävät pehmeämmiltä.` }),
  exportAnyway: (n: number) => plural(n, { one: `Vie silti (${n} pehmeämpi ikkuna)`, other: `Vie silti (${n} pehmeämpää ikkunaa)` }),
  rawNote: `InFlight kehittää RAW-kuvat kennon tiedoista kuten editorissa; kameran upotettuja esikatselukuvia ei koskaan käytetä. HEIF-alkuperäisiä ei vielä tueta kollaasissa.`,
  heif: (filename: string) => `${filename} on HEIF-tiedosto. Kollaasi ei vielä voi tarkistaa sen täysikokoisia pikseleitä, joten mitään ei pantu sen tilalle.`,
  embedded: (filename: string) => `Tiedostolla ${filename} ei ole kennon tiedoista kehitettyä kuvaa, eikä kameran upotettua esikatselukuvaa koskaan käytetä kollaasissa.`,
  done: `Kollaasi viety. Alkuperäiset kuvasi ovat ennallaan.`,
  doneSoft: (n: number) => plural(n, { one: `Kollaasi viety. ${n} ikkuna suurennettiin tai jäi alle tulostustarkkuuden, kuten ennen vientiä näytettiin. Alkuperäiset kuvasi ovat ennallaan.`, other: `Kollaasi viety. ${n} ikkunaa suurennettiin tai jäi alle tulostustarkkuuden, kuten ennen vientiä näytettiin. Alkuperäiset kuvasi ovat ennallaan.` }),
};
