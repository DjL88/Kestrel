import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  title: "Vues enregistrées",
  hint: "Conservées sur cet appareil uniquement. Une vue change les photos affichées, jamais les photos elles-mêmes.",
  none: "Aucune vue enregistrée. Choisissez des filtres, puis enregistrez-les ici avec un nom.",
  show: (name: string) => `Afficher ${name}`,
  remove: (name: string) => `Supprimer la vue enregistrée ${name}`,
  nameLabel: "Nom de ces filtres",
  save: "Enregistrer la vue",
  saved: (name: string) => `Vue ${name} enregistrée.`,
  replaced: (name: string) => `Vue ${name} mise à jour.`,
  emptyName: "Saisissez d’abord un nom pour la vue.",
  full: (max: number) => `Vous pouvez garder jusqu’à ${max} vues enregistrées. Supprimez-en une d’abord.`,
  notStored: "Cet appareil n’a pas conservé la vue : elle disparaîtra à la fermeture d’InFlight.",
  showing: (name: string) => `Vue enregistrée affichée : ${name}`,
  noneAhead: "Plus aucune photo à examiner après celle-ci parmi les photos affichées.",
  noneBehind: "Aucune photo à examiner avant celle-ci parmi les photos affichées.",
};
