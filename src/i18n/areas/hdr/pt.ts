import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (você). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  menu: (n: number) => `Juntar ${n} fotos em HDR`,
  menuHint: "Junta uma série de fotos mais escuras e mais claras numa nova foto de 16 bits que mantém as altas luzes e as sombras. Os originais não são alterados.",
  task: (n: number) => `Juntando ${n} fotos em HDR`,
  reading: "Lendo as fotos",
  aligning: "Alinhando as fotos",
  merging: "Juntando as exposições",
  saving: "Adicionando a foto HDR",
  done: (name: string, n: number) => `${name} adicionada, junta a partir de ${n} fotos. As suas fotos originais ficam intactas.`,
  cancelled: "Junção HDR interrompida. Nada foi adicionado. As suas fotos originais ficam intactas.",
  failed: "A junção HDR não terminou. Abra Tarefas para ver o motivo. As suas fotos originais ficam intactas.",
  tooFew: "Escolha pelo menos duas fotos da mesma cena, tiradas mais escuras e mais claras, para juntar em HDR. As suas fotos originais ficam intactas.",
  tooMany: (max: number) => `Escolha no máximo ${max} fotos de cada vez para juntar em HDR. As suas fotos originais ficam intactas.`,
  sizeMismatch: "Estas fotos têm tamanhos diferentes, por isso não podem ser alinhadas. As suas fotos originais ficam intactas.",
  sameExposure: "Estas fotos parecem ter a mesma exposição, por isso não há nada para juntar. Escolha uma série tirada mais escura e mais clara. As suas fotos originais ficam intactas.",
  unrelated: (n: number) => `A foto ${n} não se alinha com as outras de forma suficientemente clara, por isso nada foi junto em vez de adivinhar. Escolha imagens de uma mesma série. As suas fotos originais ficam intactas.`,
  unsupported: (name: string) => `Não é possível ler ${name} em tamanho completo aqui, por isso nada foi junto. Não foi usada uma imagem mais pequena em vez disso. As suas fotos originais ficam intactas.`,
  rawNotDeveloped: (name: string) => `Não foi possível revelar ${name} a 16 bits a partir dos dados do sensor aqui, e a pequena pré-visualização incorporada da câmara não é usada para HDR. Volte a ligar o original e tente de novo. As suas fotos originais ficam intactas.`,
  tooLarge: "Estas fotos são demasiado grandes para juntar com segurança neste dispositivo. Nada foi junto. As suas fotos originais ficam intactas.",
  ghostsRemoved: "Algo se mexeu entre as fotos. Aí, a junção usa uma só foto, para que nada apareça duas vezes.",
  highlightsClipped: "Algumas altas luzes estavam demasiado claras mesmo na foto mais escura, por isso ficam brancas.",
  mainThread: "Foi executado em primeiro plano porque aqui não há trabalho em segundo plano, por isso a aplicação pode ter parado por momentos.",
  infoTitle: "Junção HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Feita a partir de ${n} foto:`, other: `Feita a partir de ${n} fotos:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stops`,
  infoHow: "Cada parte vem das fotos bem expostas nesse ponto, alinhadas e ponderadas pela exposição, e depois ajustadas com as Altas luzes e as Sombras do editor. Nenhum píxel foi gerado.",
};
