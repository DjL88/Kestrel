import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  paint: `Peindre`,
  erase: `Effacer`,
  mode: `Mode du pinceau`,
  size: `Taille du pinceau`,
  stop: `Arrêter de peindre`,
  layer: (name: string) => `Pinceau sur ${name}`,
  help: `Faites glisser sur la photo pour peindre. Maintenez Alt pour effacer un instant. Appuyez sur [ ou ] pour changer la taille. Au clavier, les flèches déplacent le pinceau et Espace peint.`,
  painting: (name: string) => `Peinture sur ${name}. Ses réglages s'appliquent là où vous peignez.`,
  erasing: (name: string) => `Effacement sur ${name}. Ses réglages cessent là où vous effacez.`,
  added: `Masque au pinceau ajouté. Faites glisser sur la photo pour peindre là où ses réglages s'appliquent.`,
  pickMask: `Ouvrez un masque au pinceau, de sujet ou d'arrière-plan dans la liste ci-dessous, puis peignez sur la photo pour l'étendre ou l'effacer.`,
  refine: `Le pinceau et la gomme affinent aussi un masque de sujet ou d'arrière-plan : ouvrez-le dans la liste, puis peignez pour ajouter ou effacez pour retirer.`,
  full: (n: number) => `Ce masque compte déjà ${n} coups de pinceau, le maximum. Ajoutez un autre masque au pinceau pour continuer.`,
  strokes: (n: number) => plural(n, { one: `${n} coup de pinceau`, other: `${n} coups de pinceau` }),
  unavailable: `Peindre est une préversion. Activez Pinceau de masque dans Fonctions en préversion pour l'utiliser.`,
};
