import { language } from './messages';

/** Quiet, accessible colour review controls. British English is the source/fallback. */
type Controls = { check: string; more: string; fewer: string; paused: string; review: string; retry: string };
const en: Controls = {
  check: 'Check now',
  more: 'Show all findings',
  fewer: 'Show fewer findings',
  paused: 'Colour guidance is paused. Choose Check now to review this photo.',
  review: 'Colour findings',
  retry: 'Choose Check now to try again.',
};
const translations: Record<string, Controls> = {
  fr: { check: 'Vérifier', more: 'Afficher tous les résultats', fewer: 'Afficher moins de résultats', paused: 'Les conseils couleur sont en pause. Lancez une vérification pour cette photo.', review: 'Résultats couleur', retry: 'Sélectionnez Vérifier pour réessayer.' },
  de: { check: 'Jetzt prüfen', more: 'Alle Hinweise anzeigen', fewer: 'Weniger Hinweise anzeigen', paused: 'Die Farbberatung ist pausiert. Prüfen Sie dieses Foto bei Bedarf.', review: 'Farbhinweise', retry: 'Wählen Sie Jetzt prüfen, um es erneut zu versuchen.' },
  es: { check: 'Comprobar ahora', more: 'Mostrar todos los avisos', fewer: 'Mostrar menos avisos', paused: 'Las sugerencias de color están en pausa. Comprueba esta foto cuando quieras.', review: 'Avisos de color', retry: 'Selecciona Comprobar ahora para volver a intentarlo.' },
  it: { check: 'Controlla ora', more: 'Mostra tutti i risultati', fewer: 'Mostra meno risultati', paused: 'I suggerimenti sui colori sono in pausa. Controlla questa foto quando vuoi.', review: 'Risultati sui colori', retry: 'Seleziona Controlla ora per riprovare.' },
  nl: { check: 'Nu controleren', more: 'Alle bevindingen tonen', fewer: 'Minder bevindingen tonen', paused: 'Kleuradvies is gepauzeerd. Controleer deze foto wanneer je wilt.', review: 'Kleurbevindingen', retry: 'Kies Nu controleren om het opnieuw te proberen.' },
  pt: { check: 'Verificar agora', more: 'Mostrar todas as observações', fewer: 'Mostrar menos observações', paused: 'As sugestões de cor estão em pausa. Verifique esta fotografia quando quiser.', review: 'Observações de cor', retry: 'Selecione Verificar agora para tentar novamente.' },
  da: { check: 'Kontrollér nu', more: 'Vis alle fund', fewer: 'Vis færre fund', paused: 'Farvevejledning er sat på pause. Kontrollér billedet efter behov.', review: 'Farvefund', retry: 'Vælg Kontrollér nu for at prøve igen.' },
  sv: { check: 'Kontrollera nu', more: 'Visa alla fynd', fewer: 'Visa färre fynd', paused: 'Färgvägledning är pausad. Kontrollera bilden när du vill.', review: 'Färgfynd', retry: 'Välj Kontrollera nu för att försöka igen.' },
  nb: { check: 'Sjekk nå', more: 'Vis alle funn', fewer: 'Vis færre funn', paused: 'Fargeveiledning er satt på pause. Sjekk bildet når du ønsker.', review: 'Fargefunn', retry: 'Velg Sjekk nå for å prøve igjen.' },
  fi: { check: 'Tarkista nyt', more: 'Näytä kaikki havainnot', fewer: 'Näytä vähemmän havaintoja', paused: 'Väriohjeet on keskeytetty. Tarkista kuva halutessasi.', review: 'Värihavainnot', retry: 'Valitse Tarkista nyt ja yritä uudelleen.' },
};
export const colourControls: Controls = translations[language] ?? en;
