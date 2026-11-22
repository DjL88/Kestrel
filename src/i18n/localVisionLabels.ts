import { language } from './messages';

/** The on-device photo check. British English is the source and the fallback for languages not yet translated. */
type Labels = { heading: string; check: string; checking: string; note: string; changed: string; failed: string; timing: (seconds: string) => string };
const en: Labels = {
  heading: 'On-device review',
  check: 'Check photo',
  checking: 'Looking at the photo on this device…',
  note: 'Looked at on this device, with no internet. This is only an observation: nothing was changed.',
  changed: 'The photo has changed since this check. Check again to see an up-to-date view.',
  failed: 'The photo could not be checked on this device.',
  timing: (seconds) => `Took ${seconds} s.`,
};
const translations: Record<string, Labels> = {
  fr: { heading: 'Revue sur l’appareil', check: 'Vérifier la photo', checking: 'Analyse de la photo sur cet appareil…', note: 'Analysée sur cet appareil, sans internet. Ce n’est qu’une observation : rien n’a été modifié.', changed: 'La photo a changé depuis cette vérification. Relancez-la pour une vue à jour.', failed: 'La photo n’a pas pu être vérifiée sur cet appareil.', timing: (seconds) => `Durée : ${seconds} s.` },
  de: { heading: 'Prüfung auf dem Gerät', check: 'Foto prüfen', checking: 'Das Foto wird auf diesem Gerät angesehen…', note: 'Auf diesem Gerät angesehen, ohne Internet. Das ist nur eine Beobachtung: Es wurde nichts verändert.', changed: 'Das Foto hat sich seit dieser Prüfung geändert. Prüfen Sie erneut für eine aktuelle Ansicht.', failed: 'Das Foto konnte auf diesem Gerät nicht geprüft werden.', timing: (seconds) => `Dauer: ${seconds} s.` },
  es: { heading: 'Revisión en el dispositivo', check: 'Revisar la foto', checking: 'Mirando la foto en este dispositivo…', note: 'Revisada en este dispositivo, sin internet. Es solo una observación: no se ha cambiado nada.', changed: 'La foto ha cambiado desde esta revisión. Vuelve a revisarla para ver una vista actual.', failed: 'No se pudo revisar la foto en este dispositivo.', timing: (seconds) => `Tardó ${seconds} s.` },
};
export const localVisionLabels: Labels = translations[language] ?? en;
