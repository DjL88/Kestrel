import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese. DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  title: "Correção de manchas",
  intro: "Cobre pó, um raminho ou um poleiro confuso com píxeis copiados de perto na mesma foto. Nada é inventado e o ficheiro original nunca é alterado.",
  start: "Marcar manchas",
  stop: "Concluído",
  placing: "Clique ou toque em cada mancha a cobrir. Prima Escape quando terminar.",
  size: "Tamanho",
  feather: "Suavidade",
  method: "Método",
  heal: "Corrigir: misturar com o redor",
  clone: "Clonar: cópia exata",
  nextSource: "Copiar de outro sítio",
  remove: "Remover mancha",
  removeAll: "Remover todas as manchas",
  show: "Mostrar mancha",
  hide: "Ocultar mancha",
  spot: (n: number) => `Mancha ${n}`,
  hidden: "oculta",
  count: (n: number) => plural(n, { one: `${n} mancha`, other: `${n} manchas` }),
  empty: "Ainda não há manchas.",
  added: "Mancha coberta. Arraste o círculo tracejado, ou escolha Copiar de outro sítio, para mudar a origem.",
  full: (n: number) => `Esta foto já tem ${n} manchas, o máximo permitido.`,
  noSource: "Não havia nada perto suficientemente parecido para copiar. Experimente um tamanho mais pequeno.",
  unreadable: "Não foi possível ler a foto agora, por isso não foi adicionada nenhuma mancha.",
  noOther: "Não há outro sítio perto de onde copiar.",
  working: "A procurar um sítio de onde copiar…",
  historyStep: "Correção de manchas",
  layer: "Manchas corrigidas",
  select: (n: number) => `Mancha ${n}: selecionar`,
  source: (n: number) => `Origem da mancha ${n}: arraste ou use as setas`,
};
