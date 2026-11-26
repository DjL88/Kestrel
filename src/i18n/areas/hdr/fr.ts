import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fusionner ${n} photos en HDR`,
  menuHint: "Combine une série de photos plus sombres et plus claires en une nouvelle photo 16 bits qui garde les hautes lumières et les ombres. Les originaux ne sont pas modifiés.",
  task: (n: number) => `Fusion HDR de ${n} photos`,
  reading: "Lecture des photos",
  aligning: "Alignement des photos",
  merging: "Fusion des expositions",
  saving: "Ajout de la photo HDR",
  done: (name: string, n: number) => `${name} ajoutée, fusionnée à partir de ${n} photos. Vos photos originales sont intactes.`,
  cancelled: "Fusion HDR arrêtée. Rien n'a été ajouté. Vos photos originales sont intactes.",
  failed: "La fusion HDR ne s'est pas terminée. Ouvrez Tâches pour en voir la raison. Vos photos originales sont intactes.",
  tooFew: "Choisissez au moins deux photos de la même scène, prises plus sombres et plus claires, pour une fusion HDR. Vos photos originales sont intactes.",
  tooMany: (max: number) => `Choisissez au plus ${max} photos à la fois pour une fusion HDR. Vos photos originales sont intactes.`,
  sizeMismatch: "Ces photos n'ont pas la même taille, elles ne peuvent donc pas être alignées. Vos photos originales sont intactes.",
  sameExposure: "Ces photos semblent avoir la même exposition, il n'y a donc rien à fusionner. Choisissez une série prise plus sombre et plus claire. Vos photos originales sont intactes.",
  unrelated: (n: number) => `La photo ${n} ne s'aligne pas assez nettement avec les autres, rien n'a donc été fusionné plutôt que de deviner. Choisissez les images d'une même série. Vos photos originales sont intactes.`,
  unsupported: (name: string) => `${name} ne peut pas être lue en pleine taille ici, rien n'a donc été fusionné. Aucune image plus petite n'a été utilisée à la place. Vos photos originales sont intactes.`,
  rawNotDeveloped: (name: string) => `${name} n'a pas pu être développée en 16 bits à partir de ses données de capteur ici, et le petit aperçu intégré de l'appareil n'est pas utilisé pour le HDR. Reconnectez l'original et réessayez. Vos photos originales sont intactes.`,
  tooLarge: "Ces photos sont trop grandes pour être fusionnées sans risque sur cet appareil. Rien n'a été fusionné. Vos photos originales sont intactes.",
  ghostsRemoved: "Quelque chose a bougé entre les photos. À ces endroits, la fusion n'utilise qu'une seule photo, pour que rien n'apparaisse deux fois.",
  highlightsClipped: "Certaines hautes lumières étaient trop claires même dans la photo la plus sombre, elles restent donc blanches.",
  mainThread: "Il a tourné au premier plan, car le travail en arrière-plan n'est pas disponible ici : l'application a pu marquer des pauses.",
  infoTitle: "Fusion HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Créée à partir de ${n} photo :`, other: `Créée à partir de ${n} photos :` }),
  infoExposure: (name: string, ev: string) => `${name} : ${ev} IL`,
  infoHow: "Chaque zone vient des photos bien exposées à cet endroit, alignées et pondérées selon l'exposition, puis réglées avec les Hautes lumières et les Ombres de l'éditeur. Aucun pixel n'a été généré.",
  whatIs: "HDR signifie grande plage dynamique, pas haute définition. Il combine plusieurs expositions d'une même scène pour que les ciels clairs et les ombres sombres gardent leurs détails.",
  bracketTitle: "Série d'expositions",
  bracketFound: (n: number, stops: string) => `${n} photos prises à quelques instants d'intervalle avec des expositions différentes (${stops} IL).`,
  bracketFromCamera: "Votre appareil a marqué ces photos comme une série d'expositions.",
  bracketFromExposures: "Trouvées d'après leur vitesse, leur ouverture et leur ISO.",
};
