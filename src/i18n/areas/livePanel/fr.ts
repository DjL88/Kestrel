import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  open: `Prise de vue en direct`,
  openHint: `Lancez une prise de vue en direct : les images arrivent dans ce projet au fur et à mesure.`,
  title: `Prise de vue en direct`,
  intro: `Les images arrivent dans ce projet au fur et à mesure. Rien n'est modifié sur l'appareil ni dans le dossier. Pas encore testé avec un vrai appareil.`,
  source: `D'où viennent les images`,
  folder: `Un dossier`,
  folderHint: `Une application de connexion ou un autre programme enregistre les images dans un dossier de votre choix.`,
  ftpHint: `L'appareil envoie chaque image à cet ordinateur par le réseau local.`,
  usbHint: `Un aperçu : essayé seulement avec un appareil simulé pour le moment.`,
  look: `Rendu des prochaines images`,
  lookNone: `Aucun : les images arrivent telles quelles`,
  lookNote: `Chaque nouvelle image reçoit ce rendu comme retouche propre. Rendus › Aucun ou Réinitialiser le retire. Le fichier original n'est jamais modifié.`,
  room: `Afficher sur les autres écrans de ce réseau`,
  roomNote: `La tablette d'un client ou un écran de studio peut voir les images et ajouter des étoiles et des choix. Vos propres marques l'emportent toujours.`,
  start: `Lancer la prise de vue en direct`,
  stop: `Arrêter la prise de vue en direct`,
  close: `Fermer et arrêter`,
  closeNote: `Fermer ce panneau arrête la prise de vue en direct et éteint la boîte de réception et la salle.`,
  running: (n: number) => plural(n, { one: `Prise de vue en cours · ${n} image pour le moment`, other: `Prise de vue en cours · ${n} images pour le moment` }),
  lookOn: (name: string) => `Rendu des prochaines images : ${name}`,
  ftpSame: `Ces réglages restent les mêmes à chaque fois sur cet ordinateur, l'appareil garde donc ses réglages.`,
  portChanged: (port: number) => `Le port habituel était occupé, cette prise de vue utilise donc le port ${port}. Saisissez-le sur l'appareil, ou fermez l'autre programme et recommencez.`,
  newPassword: `Créer un nouveau mot de passe`,
  newPasswordNote: `Saisissez ensuite le nouveau mot de passe sur l'appareil.`,
  roomHeading: `Ouvrez cette adresse sur l'autre écran`,
  starting: `Démarrage…`,
};
