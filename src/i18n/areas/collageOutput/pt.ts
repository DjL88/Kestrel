import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (European). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  size: `Tamanho de exportação`,
  standard: (w: number, h: number) => `Normal · ${w} × ${h} px`,
  double: (w: number, h: number) => `O dobro do tamanho · ${w} × ${h} px`,
  custom: `Lado maior personalizado`,
  customEdge: `Lado maior em píxeis`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Resolução de impressão`,
  dpiOption: (n: number) => `${n} PPP`,
  pdfNote: (dpi: number) => `PDF RGB para laboratório fotográfico, ${dpi} PPI, sangria de 3 mm e caixas de corte. Não é CMYK nem PDF/X certificado.`,
  windows: `Fotografias em cada janela`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Página ${page}, fundo: ${filename}` : `Página ${page}, janela ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px na fotografia, mostrada a ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Mostrada a ${ww} × ${wh} px. O tamanho da fotografia é verificado quando a colagem é exportada.`,
  enlarged: (percent: number) => `Ampliada para ${percent}%, por isso parecerá mais suave.`,
  sharp: `Píxeis suficientes para este tamanho.`,
  ppi: (ppi: number) => `${ppi} píxeis por polegada.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} píxeis por polegada, abaixo dos ${dpi} PPP escolhidos, por isso a impressão será mais suave.`,
  lowSummary: (n: number) => plural(n, { one: `${n} janela tem menos píxeis do que este tamanho precisa. Escolha um tamanho menor, ou exporte mesmo assim e parecerá mais suave.`, other: `${n} janelas têm menos píxeis do que este tamanho precisa. Escolha um tamanho menor, ou exporte mesmo assim e parecerão mais suaves.` }),
  exportAnyway: (n: number) => plural(n, { one: `Exportar mesmo assim (${n} janela mais suave)`, other: `Exportar mesmo assim (${n} janelas mais suaves)` }),
  rawNote: `As fotografias RAW são reveladas pelo InFlight a partir dos dados do sensor, como no editor; as pré-visualizações incorporadas da câmara nunca são usadas. Os originais HEIF ainda não são suportados numa colagem.`,
  heif: (filename: string) => `${filename} é um ficheiro HEIF. Uma colagem ainda não consegue verificar os seus píxeis em resolução total, por isso nada foi posto no seu lugar.`,
  embedded: (filename: string) => `${filename} não tem uma imagem revelada a partir dos dados do sensor, e uma pré-visualização incorporada da câmara nunca é usada numa colagem.`,
  done: `Colagem exportada. Os seus originais não foram alterados.`,
  doneSoft: (n: number) => plural(n, { one: `Colagem exportada. ${n} janela foi ampliada ou ficou abaixo da resolução de impressão, como mostrado antes da exportação. Os seus originais não foram alterados.`, other: `Colagem exportada. ${n} janelas foram ampliadas ou ficaram abaixo da resolução de impressão, como mostrado antes da exportação. Os seus originais não foram alterados.` }),
};
