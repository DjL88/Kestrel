import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (você). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  title: "Vistas guardadas",
  hint: "Guardadas apenas neste dispositivo. Uma vista muda as fotos mostradas, nunca as próprias fotos.",
  none: "Ainda não há vistas guardadas. Escolha filtros e guarde-os aqui com um nome.",
  show: (name: string) => `Mostrar ${name}`,
  remove: (name: string) => `Eliminar a vista guardada ${name}`,
  nameLabel: "Nome para estes filtros",
  save: "Guardar vista",
  saved: (name: string) => `Vista ${name} guardada.`,
  replaced: (name: string) => `Vista ${name} atualizada.`,
  emptyName: "Escreva primeiro um nome para a vista.",
  full: (max: number) => `Pode guardar até ${max} vistas. Elimine uma primeiro.`,
  notStored: "Este dispositivo não guardou a vista; desaparece quando o InFlight fechar.",
  showing: (name: string) => `A mostrar a vista guardada ${name}`,
  noneAhead: "Não há mais fotos por rever depois desta entre as mostradas.",
  noneBehind: "Não há fotos por rever antes desta entre as mostradas.",
};
