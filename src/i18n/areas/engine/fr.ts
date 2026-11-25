import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Balance des blancs', temperature: 'Température', tint: 'Teinte', exposure: 'Exposition', contrast: 'Contraste',
    highlights: 'Hautes lumières', shadows: 'Ombres', whites: 'Blancs', blacks: 'Noirs', toneCurve: 'Courbe des tons',
    vibrance: 'Vibrance', saturation: 'Saturation', colourMixer: 'Mélangeur de couleurs', clarity: 'Clarté', detailRecovery: 'Texture',
    sharpen: 'Netteté', denoiseLuminance: 'Bruit de luminance', denoiseColour: 'Bruit de couleur', upscaleFactor: 'Agrandissement',
    masks: 'Réglages locaux',
  },
  notMeasured: 'Non mesuré',
  notRecorded: 'Non enregistré',
  suggestedName: (name) => `${name} (suggestion)`,
  subjectKinds: { wildlife: 'Faune', people: 'Personnes', landscape: 'Paysage', other: 'Autre sujet' },
  auto: {
    ready: 'Des suggestions de retouche vérifiées sont prêtes à prévisualiser.',
    noneDifferent: 'Aucune retouche visiblement différente n’a passé les vérifications.',
    appliedGentler: 'Auto a appliqué une version plus douce : la version complète a échoué à un contrôle de sécurité.',
    applied: 'Auto appliqué. Réglez l’intensité à votre goût, ou annulez.',
    looksGood: 'C’est bon : les valeurs mesurées sont dans la plage, donc rien n’a été changé.',
    cannotImprove: 'Impossible d’améliorer cette photo sans risque, donc rien n’a été changé.',
    withheld: 'Une retouche suggérée a été retenue, car elle a échoué à un contrôle.',
    multipleSubjects: 'Chaque sujet a été vérifié séparément pour les hautes lumières et les ombres perdues. La correction de couleur par espèce a été retenue.',
    coverageUnavailable: 'Tous les sujets n’ont pas pu être détourés, donc seules des suggestions pour toute la photo ont été prises en compte.',
    speciesReference: (features) => `Référence de l’espèce (un repère, pas une couleur mesurée) : ${features}`,
  },
  deepReview: {
    none: 'Examen approfondi : aucun sujet fiable pour le détecteur n’a été trouvé dans cette photo.',
    confidence: { high: 'élevée', medium: 'moyenne', low: 'faible' },
    sharpness: { subjectSharp: 'net', subjectOk: 'assez net', subjectSoft: 'flou', noSubject: 'incertain', unavailable: 'incertain' },
    trusted: (confidence, sharpness) => `Examen approfondi : sujet ${sharpness} trouvé, avec une confiance ${confidence}.`,
    untrusted: (sharpness) => `Examen approfondi : sujet trouvé, mais trop ${sharpness} pour être fiable.`,
    witness: { bird: 'oiseau', aircraft: 'avion', person: 'personne', animal: 'animal', vehicle: 'véhicule' },
    agreed: (subject) => `La lecture de la scène le confirme : ${subject}.`,
    conflict: (reading, detector) => `La lecture de la scène n’est pas d’accord : elle indique ${reading}, le détecteur indique ${detector}. Considérez la question comme non résolue.`,
    suggested: (name, description) => `Suggestion : « ${name} » – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Aucun bruit visible n’a été trouvé en taille réelle, donc rien n’a été changé.',
    protectionLost: 'Le sujet n’a pas pu être protégé sans risque cette fois. Vos retouches existantes ont été conservées.',
    cloud: 'Débruité dans le cloud InFlight à partir d’une copie de travail, puis vérifié sur cet appareil.',
    cloudNotUsed: 'Le cloud n’a pas été utilisé cette fois, donc le traitement a eu lieu sur cet appareil.',
    device: 'Débruité sur cet appareil.',
    layersFull: 'Chaque sujet n’a pas pu avoir son propre calque, donc un seul calque de protection commun a été utilisé.',
    protected: (count) => (count === 1
      ? 'Débruité sur cet appareil, avec le sujet protégé.'
      : `Débruité sur cet appareil, avec ${count} sujets protégés ensemble.`),
    global: 'Aucun contour de sujet n’était fiable, donc le débruitage a été appliqué uniformément à toute la photo.',
    failedCheck: 'Le résultat n’a pas passé le contrôle de qualité. Vos retouches existantes ont été conservées.',
    leftAsItWas: (notes) => `Laissé tel quel. ${notes}`,
  },
};
