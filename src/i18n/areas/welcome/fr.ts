import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  welcome: {
    title: "Bienvenue dans InFlight",
    intro: "Trois choses à savoir avant de commencer :",
    originals: "Vos photos originales restent où elles sont. InFlight ne les modifie, ne les déplace et ne les remplace jamais.",
    undo: "Chaque retouche peut être annulée. InFlight garde une recette de vos changements, pas une nouvelle copie de la photo.",
    backup: "Une sauvegarde de projet garde vos choix, vos notes et vos retouches, mais pas les fichiers RAW eux-mêmes. Sauvegardez aussi vos originaux.",
    webNote: "Dans un navigateur web, InFlight demandera au navigateur de conserver son stockage quand vous continuerez. Vous trouverez ce que cela signifie dans Réglages, sous Stockage.",
    done: "J'ai compris",
  },
  browserStorage: {
    title: "Stockage de ce navigateur",
    checking: "Vérification de ce que ce navigateur conserve…",
    standard: "Ce navigateur peut effacer le stockage d'InFlight quand l'espace manque ou quand les données du site sont effacées.",
    requesting: "Demande au navigateur de conserver le stockage d'InFlight…",
    persistent: "Ce navigateur a accepté de conserver le stockage d'InFlight. Effacer vous-même les données du site le supprime quand même.",
    declined: "Le navigateur n'a pas accepté de conserver le stockage d'InFlight. Il en décide seul, souvent selon votre usage du site. Vous pourrez redemander plus tard.",
    unavailable: "Ce navigateur ne peut pas garantir de conserver le stockage d'InFlight.",
    ask: "Demander au navigateur de conserver le stockage",
    kept: "Le stockage est conservé",
    permissionsTitle: "Autorisations des fichiers",
    permissions: "Le navigateur ne laisse InFlight lire que les photos et dossiers que vous choisissez. Après avoir fermé l'onglet ou redémarré, il peut vous redemander l'accès avant qu'InFlight puisse voir un dossier. Refuser n'abîme pas vos photos ; InFlight ne peut simplement pas les afficher tant que vous ne l'autorisez pas.",
    forgetTitle: "Ce que le navigateur peut oublier",
    forget: "Vos projets, choix, retouches et aperçus sont gardés dans ce navigateur. Effacer les données de navigation, utiliser une fenêtre privée ou désinstaller le navigateur peut les supprimer. Vos photos originales ne sont jamais stockées ni modifiées ici : elles ne risquent rien.",
    backupHint: "Par prudence, faites une sauvegarde depuis les options du projet et gardez-la, avec vos originaux, ailleurs que dans ce navigateur.",
  },
  diskPreviews: {
    title: "Aperçus sur cet ordinateur",
    intro: "InFlight garde trois petites images de chaque photo RAW dans son propre dossier : une vignette, une copie de contrôle et un aperçu dynamique de 2 560 px. Vous pouvez continuer à retoucher une photo quand son disque est débranché. L’export demande toujours l’original. Vos originaux ne sont jamais modifiés.",
    using: "{used} utilisés pour {count} photos.",
    checking: "Vérification du dossier des aperçus…",
    limitLabel: "Taille maximale",
    limitDefault: "{size} (conseillé pour cet ordinateur)",
    limitHint: "Environ {count} photos tiennent. Quand le dossier est plein, les aperçus que vous n’avez pas regardés depuis le plus longtemps sont retirés. Ils sont refaits quand vous rouvrez ces photos avec leur disque branché.",
    clear: "Retirer tous les aperçus",
    cleared: "Aperçus retirés. Ils sont refaits quand vous regardez les photos.",
    failed: "Le dossier des aperçus n’a pas pu être lu.",
  },
};
