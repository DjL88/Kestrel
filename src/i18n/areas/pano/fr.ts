import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  menu: (n: number) => `Assembler ${n} photos en panorama`,
  menuHint: "Assemble des photos qui se chevauchent en une nouvelle photo large, recadrée sur les vrais pixels. Les originaux ne sont pas modifiés.",
  task: (n: number) => `Assemblage d'un panorama de ${n} photos`,
  reading: "Lecture des photos",
  matching: "Recherche des zones de chevauchement",
  placing: "Placement des photos",
  blending: "Fusion des raccords",
  saving: "Ajout du panorama",
  done: (name: string, n: number) => `${name} ajoutée, assemblée à partir de ${n} photos. Vos photos originales sont intactes.`,
  cropNote: (percent: number) => `Recadrée sur les ${percent} % de la zone assemblée couverts par de vrais pixels. Rien n'a été inventé.`,
  cancelled: "Assemblage arrêté. Rien n'a été ajouté. Vos photos originales sont intactes.",
  failed: "Le panorama n'a pas abouti. Ouvrez Tâches pour en voir la raison. Vos photos originales sont intactes.",
  tooFew: "Choisissez au moins deux photos qui se chevauchent. Vos photos originales sont intactes.",
  tooMany: (max: number) => `Choisissez au plus ${max} photos à assembler à la fois. Vos photos originales sont intactes.`,
  sizeMismatch: "Ces photos n'ont pas la même taille, elles n'ont donc pas été assemblées. Vos photos originales sont intactes.",
  tooFlat: (n: number) => `La photo ${n} a trop peu de détails pour être alignée, rien n'a donc été assemblé plutôt que de deviner. Vos photos originales sont intactes.`,
  unrelated: (n: number) => `La photo ${n} ne chevauche pas assez la précédente pour les aligner, rien n'a donc été assemblé. Choisissez les photos dans l'ordre de prise de vue, chacune recouvrant la suivante d'environ un tiers. Vos photos originales sont intactes.`,
  ambiguous: (n: number) => `On ne sait pas où la photo ${n} rejoint la précédente. Le motif se répète, ou l'appareil a trop penché, donc rien n'a été assemblé plutôt que de deviner. Vos photos originales sont intactes.`,
  vertical: "Ces photos vont de haut en bas plutôt que de gauche à droite. Les panoramas verticaux ne sont pas encore pris en charge, rien n'a donc été assemblé. Vos photos originales sont intactes.",
  tooLarge: "Ce panorama serait trop grand pour être créé sans risque sur cet appareil, et il n'est pas réduit sans vous le demander. Choisissez moins de photos. Vos photos originales sont intactes.",
  noCoverage: "Les photos ne laissent aucun rectangle couvert de vrais pixels, rien n'a donc été assemblé plutôt que de combler des vides. Vos photos originales sont intactes.",
  unsupported: (name: string) => `${name} ne peut pas être lue en pleine taille ici, rien n'a donc été assemblé. Aucune image plus petite n'a été utilisée à la place. Vos photos originales sont intactes.`,
  rawNotDeveloped: (name: string) => `${name} n'a pas encore de développement pleine taille depuis les données du capteur, et le petit aperçu intégré de l'appareil n'est pas utilisé pour les panoramas. Faites d'abord le développement pleine taille. Vos photos originales sont intactes.`,
  exposureDiffers: "Les photos ont été prises avec des luminosités assez différentes. Elles ont été harmonisées, mais vérifiez les bandes dans le ciel.",
  seamsVisible: "Certains raccords peuvent se voir : quelque chose a bougé entre les photos, ou l'appareil s'est déplacé au lieu de pivoter.",
  focalEstimated: "La focale de l'objectif n'était pas enregistrée, elle a donc été déduite des photos.",
  mainThread: "Il a tourné au premier plan, car le travail en arrière-plan n'est pas disponible ici : l'application a pu marquer des pauses.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Assemblée à partir de ${n} photo :`, other: `Assemblée à partir de ${n} photos :` }),
  infoHow: "Placées sur un cylindre, raccords fondus en douceur et recadrées sur les vrais pixels. Aucun pixel n'a été généré.",
};
