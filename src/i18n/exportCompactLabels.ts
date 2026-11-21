import { language } from './messages';

/** Small export surface kept separate from the legacy four-step wizard. */
const en = {
  exportTab: 'Export',
  advancedTab: 'Advanced',
  tabList: 'Export settings',
  popular: 'Popular social sizes',
  more: 'More sizes',
  shared: 'One output for the platforms shown. Different crops or quality settings stay separate.',
  finishing: 'Text, watermark and finishing options',
  suitable: 'Suitable for',
  showProof: 'Show preview',
  hideProof: 'Hide preview',
};
type Copy = typeof en;
const copies: Partial<Record<string, Copy>> = {
  fr: { exportTab: 'Exporter', advancedTab: 'Avancé', tabList: 'Paramètres d’exportation', popular: 'Formats courants pour les réseaux sociaux', more: 'Autres formats', shared: 'Un seul fichier pour les plateformes indiquées. Les recadrages et qualités différents restent séparés.', finishing: 'Texte, filigrane et options de finition', suitable: 'Convient à', showProof: 'Afficher l’aperçu', hideProof: 'Masquer l’aperçu' },
  de: { exportTab: 'Exportieren', advancedTab: 'Erweitert', tabList: 'Exporteinstellungen', popular: 'Gängige Social-Media-Größen', more: 'Weitere Größen', shared: 'Eine Datei für die gezeigten Plattformen. Unterschiedliche Zuschnitte oder Qualitätseinstellungen bleiben getrennt.', finishing: 'Text, Wasserzeichen und weitere Optionen', suitable: 'Geeignet für', showProof: 'Vorschau zeigen', hideProof: 'Vorschau ausblenden' },
  es: { exportTab: 'Exportar', advancedTab: 'Avanzado', tabList: 'Ajustes de exportación', popular: 'Tamaños habituales para redes sociales', more: 'Más tamaños', shared: 'Un archivo para las plataformas indicadas. Los recortes o ajustes de calidad distintos se mantienen separados.', finishing: 'Texto, marca de agua y opciones finales', suitable: 'Apto para', showProof: 'Mostrar vista previa', hideProof: 'Ocultar vista previa' },
  nl: { exportTab: 'Exporteren', advancedTab: 'Geavanceerd', tabList: 'Exportinstellingen', popular: 'Veelgebruikte formaten voor sociale media', more: 'Meer formaten', shared: 'Eén bestand voor de getoonde platforms. Andere uitsneden of kwaliteitsinstellingen blijven apart.', finishing: 'Tekst, watermerk en overige opties', suitable: 'Geschikt voor', showProof: 'Voorbeeld tonen', hideProof: 'Voorbeeld verbergen' },
  it: { exportTab: 'Esporta', advancedTab: 'Avanzate', tabList: 'Impostazioni di esportazione', popular: 'Formati comuni per i social', more: 'Altri formati', shared: 'Un file per le piattaforme indicate. Ritagli o qualità differenti restano separati.', finishing: 'Testo, filigrana e opzioni finali', suitable: 'Adatto a', showProof: 'Mostra anteprima', hideProof: 'Nascondi anteprima' },
  pt: { exportTab: 'Exportar', advancedTab: 'Avançado', tabList: 'Definições de exportação', popular: 'Tamanhos comuns para redes sociais', more: 'Mais tamanhos', shared: 'Um ficheiro para as plataformas indicadas. Recortes e qualidades diferentes ficam separados.', finishing: 'Texto, marca de água e opções finais', suitable: 'Adequado para', showProof: 'Mostrar pré-visualização', hideProof: 'Ocultar pré-visualização' },
  da: { exportTab: 'Eksportér', advancedTab: 'Avanceret', tabList: 'Eksportindstillinger', popular: 'Almindelige størrelser til sociale medier', more: 'Flere størrelser', shared: 'Én fil til de viste platforme. Forskellig beskæring eller kvalitet forbliver adskilt.', finishing: 'Tekst, vandmærke og flere indstillinger', suitable: 'Passer til', showProof: 'Vis eksempel', hideProof: 'Skjul eksempel' },
  sv: { exportTab: 'Exportera', advancedTab: 'Avancerat', tabList: 'Exportinställningar', popular: 'Vanliga storlekar för sociala medier', more: 'Fler storlekar', shared: 'En fil för plattformarna som visas. Olika beskärning eller kvalitet hålls separat.', finishing: 'Text, vattenstämpel och fler alternativ', suitable: 'Passar för', showProof: 'Visa förhandsgranskning', hideProof: 'Dölj förhandsgranskning' },
  nb: { exportTab: 'Eksporter', advancedTab: 'Avansert', tabList: 'Eksportinnstillinger', popular: 'Vanlige størrelser for sosiale medier', more: 'Flere størrelser', shared: 'Én fil til plattformene som vises. Ulike utsnitt eller kvaliteter holdes atskilt.', finishing: 'Tekst, vannmerke og flere valg', suitable: 'Passer for', showProof: 'Vis forhåndsvisning', hideProof: 'Skjul forhåndsvisning' },
  fi: { exportTab: 'Vie', advancedTab: 'Lisäasetukset', tabList: 'Vientiasetukset', popular: 'Yleiset somekoot', more: 'Lisää kokoja', shared: 'Yksi tiedosto näytetyille alustoille. Eri rajaukset tai laatuasetukset pidetään erillään.', finishing: 'Teksti, vesileima ja viimeistely', suitable: 'Sopii palveluihin', showProof: 'Näytä esikatselu', hideProof: 'Piilota esikatselu' },
  is: { exportTab: 'Flytja út', advancedTab: 'Ítarlegt', tabList: 'Útflutningsstillingar', popular: 'Algengar stærðir fyrir samfélagsmiðla', more: 'Fleiri stærðir', shared: 'Ein skrá fyrir sýnda miðla. Mismunandi skurður eða gæði eru aðskilin.', finishing: 'Texti, vatnsmerki og fleiri stillingar', suitable: 'Hentar fyrir', showProof: 'Sýna forskoðun', hideProof: 'Fela forskoðun' },
  cy: { exportTab: 'Allforio', advancedTab: 'Uwch', tabList: 'Gosodiadau allforio', popular: 'Meintiau cyffredin ar gyfer cyfryngau cymdeithasol', more: 'Rhagor o feintiau', shared: 'Un ffeil ar gyfer y llwyfannau a ddangosir. Cedwir cnydau neu ansawdd gwahanol ar wahân.', finishing: 'Testun, dyfrnod ac opsiynau ychwanegol', suitable: 'Addas ar gyfer', showProof: 'Dangos rhagolwg', hideProof: 'Cuddio rhagolwg' },
  ga: { exportTab: 'Easpórtáil', advancedTab: 'Casta', tabList: 'Socruithe easpórtála', popular: 'Méideanna coitianta do na meáin shóisialta', more: 'Tuilleadh méideanna', shared: 'Comhad amháin do na hardáin a thaispeántar. Coinnítear bearradh nó cáilíocht dhifriúil ar leith.', finishing: 'Téacs, comhartha uisce agus roghanna eile', suitable: 'Oiriúnach do', showProof: 'Taispeáin réamhamharc', hideProof: 'Folaigh réamhamharc' },
  gd: { exportTab: 'Às-phortaich', advancedTab: 'Adhartach', tabList: 'Roghainnean às-phortaidh', popular: 'Meudan cumanta airson nam meadhanan sòisealta', more: 'Barrachd mheudan', shared: 'Aon fhaidhle airson nan àrd-ùrlaran seo. Thèid bàrr is càileachd eadar-dhealaichte a chumail fa leth.', finishing: 'Teacsa, comharra-uisge is roghainnean eile', suitable: 'Freagarrach do', showProof: 'Seall ro-shealladh', hideProof: 'Falaich ro-shealladh' },
};
const code = language === 'fr-CA' ? 'fr' : language;
export const exportCompactLabels = copies[code] ?? en;
