import { language } from './messages';
import type { GuidanceMode } from '../core/guidanceMode';

/** Mode names and explanations stay together, including in the compact View selector. */
type Copy = { title: string; help: string; modes: Record<GuidanceMode, [string, string]> };
const en: Copy = {
  title: 'Photographic guidance',
  help: 'Choose how much help InFlight offers. All changes are reversible.',
  modes: {
    soar: ['Auto Pilot', 'Gentle automatic changes only when evidence is strong.'],
    glide: ['Co Pilot', 'Quiet suggestions. You choose what to apply.'],
    solo: ['Solo', 'No unsolicited advice. Ask whenever you want help.'],
  },
};
/** Human-readable translations; fall back to British English if a locale is not yet reviewed. */
const translations: Partial<Record<string, Copy>> = {
  'en-US': en, 'en-CA': en, 'en-AU': en, 'en-NZ': en,
  fr: { title: 'Conseils photo', help: 'Choisissez le niveau d’aide. Toute modification est réversible.', modes: {
    soar: ['Auto Pilot', 'Ajustements doux automatiques uniquement si les indices sont solides.'],
    glide: ['Co Pilot', 'Suggestions discrètes. Vous décidez de les appliquer.'],
    solo: ['Solo', 'Aucun conseil spontané. Demandez de l’aide quand vous le souhaitez.'],
  }},
  de: { title: 'Fotografische Hilfe', help: 'Wählen Sie, wie viel Hilfe Sie möchten. Alle Änderungen sind rückgängig zu machen.', modes: {
    soar: ['Auto Pilot', 'Sanfte automatische Änderungen nur bei eindeutigen Hinweisen.'],
    glide: ['Co Pilot', 'Unaufdringliche Vorschläge. Sie entscheiden.'],
    solo: ['Solo', 'Keine unaufgeforderten Tipps. Hilfe nur auf Anfrage.'],
  }},
  es: { title: 'Ayuda fotográfica', help: 'Elige cuánta ayuda quieres. Todos los cambios se pueden deshacer.', modes: {
    soar: ['Auto Pilot', 'Cambios automáticos suaves solo con pruebas sólidas.'],
    glide: ['Co Pilot', 'Sugerencias discretas. Tú decides cuáles aplicar.'],
    solo: ['Solo', 'Sin consejos no solicitados. Pide ayuda cuando quieras.'],
  }},
  it: { title: 'Guida fotografica', help: 'Scegli quanta assistenza ricevere. Ogni modifica è reversibile.', modes: {
    soar: ['Auto Pilot', 'Piccole modifiche automatiche solo con prove solide.'],
    glide: ['Co Pilot', 'Suggerimenti discreti. Decidi tu se applicarli.'],
    solo: ['Solo', 'Nessun consiglio non richiesto. Chiedi aiuto quando vuoi.'],
  }},
  nl: { title: 'Fotografische hulp', help: 'Kies hoeveel hulp je wilt. Alle wijzigingen zijn omkeerbaar.', modes: {
    soar: ['Auto Pilot', 'Zachte automatische aanpassingen alleen bij sterk bewijs.'],
    glide: ['Co Pilot', 'Rustige suggesties. Jij kiest wat je toepast.'],
    solo: ['Solo', 'Geen ongevraagd advies. Vraag hulp wanneer je wilt.'],
  }},
  pt: { title: 'Orientação fotográfica', help: 'Escolha quanta ajuda pretende. Todas as alterações são reversíveis.', modes: {
    soar: ['Auto Pilot', 'Ajustes automáticos suaves apenas com provas fortes.'],
    glide: ['Co Pilot', 'Sugestões discretas. Decide o que aplicar.'],
    solo: ['Solo', 'Sem conselhos não pedidos. Peça ajuda quando quiser.'],
  }},
  da: { title: 'Fotovejledning', help: 'Vælg, hvor meget hjælp du ønsker. Alle ændringer kan fortrydes.', modes: {
    soar: ['Auto Pilot', 'Små automatiske ændringer kun ved tydelige tegn.'],
    glide: ['Co Pilot', 'Diskrete forslag. Du vælger, hvad du vil bruge.'],
    solo: ['Solo', 'Ingen uopfordrede råd. Bed om hjælp, når du vil.'],
  }},
  sv: { title: 'Fotohjälp', help: 'Välj hur mycket hjälp du vill ha. Alla ändringar kan ångras.', modes: {
    soar: ['Auto Pilot', 'Varsamma automatiska ändringar bara med starka belägg.'],
    glide: ['Co Pilot', 'Diskreta förslag. Du väljer vad du använder.'],
    solo: ['Solo', 'Inga oombedda råd. Be om hjälp när du vill.'],
  }},
  nb: { title: 'Fotoveiledning', help: 'Velg hvor mye hjelp du ønsker. Alle endringer kan angres.', modes: {
    soar: ['Auto Pilot', 'Forsiktige automatiske endringer bare ved tydelige bevis.'],
    glide: ['Co Pilot', 'Diskré forslag. Du bestemmer hva du bruker.'],
    solo: ['Solo', 'Ingen ubedte råd. Be om hjelp når du vil.'],
  }},
  fi: { title: 'Kuvausohjeet', help: 'Valitse, kuinka paljon apua haluat. Kaikki muutokset voi kumota.', modes: {
    soar: ['Auto Pilot', 'Hienovaraisia automaattisia muutoksia vain vahvan näytön perusteella.'],
    glide: ['Co Pilot', 'Huomaamattomia ehdotuksia. Päätät itse niiden käytöstä.'],
    solo: ['Solo', 'Ei pyytämättömiä neuvoja. Pyydä apua halutessasi.'],
  }},
};
export const guidanceCopy: Copy = translations[language] ?? en;
