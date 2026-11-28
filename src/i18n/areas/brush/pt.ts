import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (European). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  paint: `Pintar`,
  erase: `Apagar`,
  mode: `Modo do pincel`,
  size: `Tamanho do pincel`,
  stop: `Parar de pintar`,
  layer: (name: string) => `Pincel sobre ${name}`,
  help: `Arraste sobre a fotografia para pintar. Mantenha Alt premida para apagar por um momento. Prima [ ou ] para mudar o tamanho. Com o teclado, as setas movem o pincel e a barra de espaço pinta.`,
  painting: (name: string) => `A pintar sobre ${name}. Os seus ajustes aplicam-se onde pinta.`,
  erasing: (name: string) => `A apagar de ${name}. Os seus ajustes deixam de se aplicar onde apaga.`,
  added: `Máscara de pincel adicionada. Arraste sobre a fotografia para pintar onde os seus ajustes se aplicam.`,
  pickMask: `Abra uma máscara de pincel, de motivo ou de fundo na lista abaixo e pinte sobre a fotografia para a alargar ou apagar.`,
  refine: `O pincel e a borracha também afinam uma máscara de motivo ou de fundo: abra-a na lista e pinte para acrescentar ou apague para retirar.`,
  full: (n: number) => `Esta máscara já tem ${n} pinceladas, o máximo. Adicione outra máscara de pincel para continuar a pintar.`,
  strokes: (n: number) => plural(n, { one: `${n} pincelada`, other: `${n} pinceladas` }),
  unavailable: `Pintar é uma pré-visualização. Ative Pincel de máscara em Funcionalidades em pré-visualização para o usar.`,
};
