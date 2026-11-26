import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (European). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  menu: (n: number) => `Juntar ${n} fotos num panorama`,
  menuHint: "Junta fotos sobrepostas numa nova foto larga, recortada apenas a píxeis reais. Os originais não são alterados.",
  task: (n: number) => `A juntar um panorama de ${n} fotos`,
  reading: "A ler as fotos",
  matching: "A procurar onde as fotos se sobrepõem",
  placing: "A posicionar as fotos",
  blending: "A fundir as junções",
  saving: "A adicionar o panorama",
  done: (name: string, n: number) => `Adicionada ${name}, junta a partir de ${n} fotos. As suas fotos originais ficam intactas.`,
  cropNote: (percent: number) => `Recortada aos ${percent}% da área junta que píxeis reais cobrem. Nada foi preenchido.`,
  cancelled: "Junção interrompida. Nada foi adicionado. As suas fotos originais ficam intactas.",
  failed: "O panorama não terminou. Abra Tarefas para ver o motivo. As suas fotos originais ficam intactas.",
  tooFew: "Escolha pelo menos duas fotos que se sobreponham. As suas fotos originais ficam intactas.",
  tooMany: (max: number) => `Escolha no máximo ${max} fotos de cada vez. As suas fotos originais ficam intactas.`,
  sizeMismatch: "Estas fotos têm tamanhos diferentes, por isso não foram juntas. As suas fotos originais ficam intactas.",
  tooFlat: (n: number) => `A foto ${n} tem pouco detalhe para alinhar, por isso nada foi junto em vez de adivinhar. As suas fotos originais ficam intactas.`,
  unrelated: (n: number) => `A foto ${n} não se sobrepõe o suficiente à anterior para as alinhar, por isso nada foi junto. Escolha as fotos pela ordem em que as tirou, cada uma a cobrir cerca de um terço da seguinte. As suas fotos originais ficam intactas.`,
  ambiguous: (n: number) => `Não é claro onde a foto ${n} se junta à anterior. O padrão repete-se, ou a câmara inclinou demasiado, por isso nada foi junto em vez de adivinhar. As suas fotos originais ficam intactas.`,
  vertical: "Estas fotos vão de cima para baixo em vez de lado a lado. Os panoramas verticais ainda não são suportados, por isso nada foi junto. As suas fotos originais ficam intactas.",
  tooLarge: "Este panorama seria demasiado grande para criar com segurança neste dispositivo, e não é reduzido sem perguntar. Escolha menos fotos. As suas fotos originais ficam intactas.",
  noCoverage: "As fotos não deixam um retângulo coberto por píxeis reais, por isso nada foi junto em vez de preencher falhas. As suas fotos originais ficam intactas.",
  unsupported: (name: string) => `Não é possível ler ${name} em tamanho completo aqui, por isso nada foi junto. Não foi usada uma imagem mais pequena em vez disso. As suas fotos originais ficam intactas.`,
  rawNotDeveloped: (name: string) => `${name} ainda não tem uma revelação em tamanho completo dos dados do sensor, e a pequena pré-visualização incorporada da câmara não é usada em panoramas. Faça primeiro a revelação em tamanho completo. As suas fotos originais ficam intactas.`,
  exposureDiffers: "As fotos foram tiradas com brilhos bastante diferentes. Foram igualadas, mas verifique se há faixas no céu.",
  seamsVisible: "Algumas junções podem notar-se: algo mexeu entre as fotos, ou a câmara deslocou-se em vez de rodar.",
  focalEstimated: "A distância focal da objetiva não estava registada, por isso foi calculada a partir das fotos.",
  mainThread: "Foi executado em primeiro plano porque aqui não há trabalho em segundo plano, por isso a aplicação pode ter parado por momentos.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Junta a partir de ${n} foto:`, other: `Junta a partir de ${n} fotos:` }),
  infoHow: "Colocadas num cilindro, junções fundidas suavemente e recortada a píxeis reais. Nenhum píxel foi gerado.",
};
