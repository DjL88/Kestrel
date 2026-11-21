import { language } from './messages';

/** Quiet, accessible colour review controls. British English is the source/fallback. */
type Controls = { check: string; more: string; fewer: string; paused: string; review: string };
const en: Controls = {
  check: 'Check now',
  more: 'Show all findings',
  fewer: 'Show fewer findings',
  paused: 'Colour guidance is paused. Choose Check now to review this photo.',
  review: 'Colour findings',
};
const translations: Record<string, Controls> = {
  fr: { check: 'Vérifier', more: 'Afficher tous les résultats', fewer: 'Afficher moins de résultats', paused: 'Les conseils couleur sont en pause. Lancez une vérification pour cette photo.', review: 'Résultats couleur' },
  de: { check: 'Jetzt prüfen', more: 'Alle Hinweise anzeigen', fewer: 'Weniger Hinweise anzeigen', paused: 'Die Farbberatung ist pausiert. Prüfen Sie dieses Foto bei Bedarf.', review: 'Farbhinweise' },
  es: { check: 'Comprobar ahora', more: 'Mostrar todos los avisos', fewer: 'Mostrar menos avisos', paused: 'Las sugerencias de color están en pausa. Comprueba esta foto cuando quieras.', review: 'Avisos de color' },
  it: { check: 'Controlla ora', more: 'Mostra tutti i risultati', fewer: 'Mostra meno risultati', paused: 'I suggerimenti sui colori sono in pausa. Controlla questa foto quando vuoi.', review: 'Risultati sui colori' },
  nl: { check: 'Nu controleren', more: 'Alle bevindingen tonen', fewer: 'Minder bevindingen tonen', paused: 'Kleuradvies is gepauzeerd. Controleer deze foto wanneer je wilt.', review: 'Kleurbevindingen' },
  pt: { check: 'Verificar agora', more: 'Mostrar todas as observações', fewer: 'Mostrar menos observações', paused: 'As sugestões de cor estão em pausa. Verifique esta fotografia quando quiser.', review: 'Observações de cor' },
  da: { check: 'Kontrollér nu', more: 'Vis alle fund', fewer: 'Vis færre fund', paused: 'Farvevejledning er sat på pause. Kontrollér billedet efter behov.', review: 'Farvefund' },
  sv: { check: 'Kontrollera nu', more: 'Visa alla fynd', fewer: 'Visa färre fynd', paused: 'Färgvägledning är pausad. Kontrollera bilden när du vill.', review: 'Färgfynd' },
  nb: { check: 'Sjekk nå', more: 'Vis alle funn', fewer: 'Vis færre funn', paused: 'Fargeveiledning er satt på pause. Sjekk bildet når du ønsker.', review: 'Fargefunn' },
  fi: { check: 'Tarkista nyt', more: 'Näytä kaikki havainnot', fewer: 'Näytä vähemmän havaintoja', paused: 'Väriohjeet on keskeytetty. Tarkista kuva halutessasi.', review: 'Värihavainnot' },
};
export const colourControls: Controls = translations[language] ?? en;
