import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  title: "Vistas guardadas",
  hint: "Solo en este dispositivo. Una vista cambia qué fotos se muestran, nunca las fotos.",
  none: "Aún no hay vistas guardadas. Elija filtros y guárdelos aquí con un nombre.",
  show: (name: string) => `Mostrar ${name}`,
  remove: (name: string) => `Eliminar la vista guardada ${name}`,
  nameLabel: "Nombre para estos filtros",
  save: "Guardar vista",
  saved: (name: string) => `Vista ${name} guardada.`,
  replaced: (name: string) => `Vista ${name} actualizada.`,
  emptyName: "Escriba primero un nombre para la vista.",
  full: (max: number) => `Puede guardar hasta ${max} vistas. Elimine una primero.`,
  notStored: "Este dispositivo no guardó la vista; desaparecerá al cerrar InFlight.",
  showing: (name: string) => `Mostrando la vista guardada ${name}`,
  noneAhead: "No quedan más fotos por revisar después de esta entre las mostradas.",
  noneBehind: "No hay fotos por revisar antes de esta entre las mostradas.",
};
