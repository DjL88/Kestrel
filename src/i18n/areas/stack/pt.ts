import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (você). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  menu: (n: number) => `Empilhar o foco de ${n} fotos`,
  menuHint: "Junta as partes mais nítidas de cada foto numa foto nova. Os originais não são alterados.",
  task: (n: number) => `Empilhando o foco de ${n} fotos`,
  reading: "Lendo as fotos",
  aligning: "Alinhando as fotos",
  blending: "Juntando as partes mais nítidas",
  saving: "Adicionando a foto empilhada",
  done: (name: string, n: number) => `${name} adicionada, empilhada a partir de ${n} fotos. As suas fotos originais ficam intactas.`,
  cancelled: "Empilhamento interrompido. Nada foi adicionado. As suas fotos originais ficam intactas.",
  failed: "O empilhamento não terminou. Abra Tarefas para ver o motivo. As suas fotos originais ficam intactas.",
  tooFew: "Escolha pelo menos duas fotos da mesma cena. As suas fotos originais ficam intactas.",
  tooMany: (max: number) => `Escolha no máximo ${max} fotos de cada vez. As suas fotos originais ficam intactas.`,
  sizeMismatch: "Estas fotos têm tamanhos diferentes, por isso não podem ser alinhadas. As suas fotos originais ficam intactas.",
  unrelated: (n: number) => `A foto ${n} não parece ser a mesma cena que a vizinha, por isso nada foi empilhado. Escolha fotogramas de uma mesma sequência. As suas fotos originais ficam intactas.`,
  ambiguous: (n: number) => `Não é claro como a foto ${n} se alinha com a vizinha (o padrão repete-se ou mexeu-se demasiado), por isso nada foi empilhado em vez de adivinhar. As suas fotos originais ficam intactas.`,
  tooFlat: (n: number) => `A foto ${n} tem pouco detalhe para ser alinhada, por isso nada foi empilhado em vez de adivinhar. As suas fotos originais ficam intactas.`,
  unsupported: (name: string) => `Não é possível ler ${name} em tamanho completo aqui, por isso nada foi empilhado. Não foi usada uma imagem mais pequena em vez disso. As suas fotos originais ficam intactas.`,
  rawNotDeveloped: (name: string) => `${name} ainda não tem uma revelação em tamanho completo dos dados do sensor, e a pequena pré-visualização incorporada da câmara não é usada. Faça primeiro a revelação em tamanho completo. As suas fotos originais ficam intactas.`,
  tooLarge: "Estas fotos são demasiado grandes para empilhar com segurança neste dispositivo. Nada foi empilhado. As suas fotos originais ficam intactas.",
  equallySharp: "Estas fotos parecem igualmente nítidas em todo o lado, por isso o resultado pode parecer-se muito com os originais.",
  frameUnused: (n: number) => `A foto ${n} quase não acrescentou nada.`,
  oneFrameDominates: "Uma só foto forneceu quase todo o detalhe. Verifique se as fotos foram tiradas a distâncias de foco diferentes.",
  localFallback: (n: number) => `A foto ${n} só foi alinhada como um todo: tinha pouco detalhe correspondente para um alinhamento mais fino.`,
  mainThread: "Foi executado em primeiro plano porque aqui não há trabalho em segundo plano, por isso a aplicação pode ter parado por momentos.",
  infoTitle: "Empilhamento de foco",
  infoMadeFrom: (n: number) => plural(n, { one: `Feita a partir de ${n} foto:`, other: `Feita a partir de ${n} fotos:` }),
  infoHow: "Cada parte vem da foto mais nítida nesse local, junta com suavidade. Nenhum píxel foi gerado.",
};
