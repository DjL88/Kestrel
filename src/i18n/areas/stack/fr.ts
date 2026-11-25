import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  menu: (n: number) => `Empiler la mise au point de ${n} photos`,
  menuHint: "Fusionne les parties les plus nettes de chaque photo dans une nouvelle photo. Les originaux ne sont pas modifiés.",
  task: (n: number) => `Empilement de mise au point de ${n} photos`,
  reading: "Lecture des photos",
  aligning: "Alignement des photos",
  blending: "Fusion des parties les plus nettes",
  saving: "Ajout de la photo empilée",
  done: (name: string, n: number) => `${name} ajoutée, empilée à partir de ${n} photos. Vos photos originales sont intactes.`,
  cancelled: "Empilement arrêté. Rien n'a été ajouté. Vos photos originales sont intactes.",
  failed: "L'empilement ne s'est pas terminé. Ouvrez Tâches pour en voir la raison. Vos photos originales sont intactes.",
  tooFew: "Choisissez au moins deux photos de la même scène. Vos photos originales sont intactes.",
  tooMany: (max: number) => `Choisissez au plus ${max} photos à la fois. Vos photos originales sont intactes.`,
  sizeMismatch: "Ces photos n'ont pas la même taille, elles ne peuvent donc pas être alignées. Vos photos originales sont intactes.",
  unrelated: (n: number) => `La photo ${n} ne semble pas montrer la même scène que sa voisine, rien n'a donc été empilé. Choisissez des images d'une même rafale. Vos photos originales sont intactes.`,
  ambiguous: (n: number) => `On ne sait pas comment la photo ${n} s'aligne sur sa voisine (motif répétitif ou trop de mouvement) : rien n'a été empilé plutôt que de deviner. Vos photos originales sont intactes.`,
  tooFlat: (n: number) => `La photo ${n} a trop peu de détails pour être alignée : rien n'a été empilé plutôt que de deviner. Vos photos originales sont intactes.`,
  unsupported: (name: string) => `${name} ne peut pas être lue en pleine taille ici, rien n'a donc été empilé. Aucune image plus petite n'a été utilisée à la place. Vos photos originales sont intactes.`,
  rawNotDeveloped: (name: string) => `${name} n'a pas encore de développement pleine taille depuis les données du capteur, et le petit aperçu intégré de l'appareil n'est pas utilisé pour l'empilement. Faites d'abord le développement pleine taille. Vos photos originales sont intactes.`,
  tooLarge: "Ces photos sont trop grandes pour être empilées sans risque sur cet appareil. Rien n'a été empilé. Vos photos originales sont intactes.",
  equallySharp: "Ces photos semblent aussi nettes partout : la pile risque de ressembler beaucoup aux originaux.",
  frameUnused: (n: number) => `La photo ${n} n'a presque rien apporté à la pile.`,
  oneFrameDominates: "Une seule photo a fourni presque tout le détail. Vérifiez que les photos ont été prises à des distances de mise au point différentes.",
  localFallback: (n: number) => `La photo ${n} n'a été alignée que dans son ensemble : trop peu de détails correspondants pour un alignement plus fin.`,
  infoTitle: "Empilement de mise au point",
  infoMadeFrom: (n: number) => plural(n, { one: `Créée à partir de ${n} photo :`, other: `Créée à partir de ${n} photos :` }),
  infoHow: "Chaque partie vient de la photo la plus nette à cet endroit, fusionnée en douceur. Aucun pixel n'a été généré.",
};
