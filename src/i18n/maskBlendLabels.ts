import { language } from './messages';

/** UI-only copy; the mask engine retains its independent, non-generative evidence contract. */
type Copy = { action: string; explanation: string; strong: string; boundary: string };
const en: Copy = {
  action: 'Blend edges',
  explanation: 'Soften a subject adjustment without changing the original or painted mask. You can undo it.',
  strong: 'This local adjustment is quite strong. A softer transition may look more natural.',
  boundary: 'Part of this adjustment changes sharply at the mask edge in the small preview. A softer transition may help.',
};
const translations: Record<string, Copy> = {
  fr: { action: 'Adoucir les bords', explanation: 'Adoucit le réglage du sujet sans modifier l’original ni le masque peint. Annulation possible.', strong: 'Ce réglage local est assez fort. Une transition plus douce peut paraître naturelle.', boundary: 'Le réglage change brusquement au bord du masque dans l’aperçu réduit. Une transition plus douce peut aider.' },
  de: { action: 'Kanten weichzeichnen', explanation: 'Mildert die Motivanpassung, ohne Original oder gemalte Maske zu ändern. Rückgängig möglich.', strong: 'Diese lokale Anpassung ist recht stark. Ein weicherer Übergang kann natürlicher wirken.', boundary: 'Im kleinen Vorschaubild ändert sich die Anpassung am Maskenrand abrupt. Ein weicherer Übergang kann helfen.' },
  es: { action: 'Suavizar bordes', explanation: 'Suaviza el ajuste del sujeto sin cambiar el original ni la máscara pintada. Se puede deshacer.', strong: 'Este ajuste local es bastante intenso. Una transición más suave puede resultar natural.', boundary: 'En la vista previa pequeña, el ajuste cambia bruscamente en el borde de la máscara. Suavizarlo puede ayudar.' },
  it: { action: 'Sfuma i bordi', explanation: 'Ammorbidisce la regolazione del soggetto senza cambiare l’originale o la maschera dipinta. Puoi annullare.', strong: 'Questa regolazione locale è piuttosto intensa. Una transizione più morbida può sembrare naturale.', boundary: 'Nella piccola anteprima la regolazione cambia bruscamente sul bordo della maschera. Una sfumatura può aiutare.' },
  nl: { action: 'Randen verzachten', explanation: 'Verzacht de onderwerpbewerking zonder het origineel of het geschilderde masker te wijzigen. Ongedaan maken kan.', strong: 'Deze plaatselijke aanpassing is vrij sterk. Een zachtere overgang kan natuurlijker ogen.', boundary: 'In het kleine voorbeeld verandert de aanpassing abrupt bij de maskerrand. Een zachtere overgang kan helpen.' },
  pt: { action: 'Suavizar contornos', explanation: 'Suaviza o ajuste do motivo sem alterar o original nem a máscara pintada. Pode anular.', strong: 'Este ajuste local é bastante forte. Uma transição mais suave pode parecer natural.', boundary: 'Na pequena pré-visualização, o ajuste muda bruscamente na margem da máscara. Suavizar pode ajudar.' },
  da: { action: 'Blødgør kanter', explanation: 'Blødgør motivjusteringen uden at ændre originalen eller den malede maske. Kan fortrydes.', strong: 'Denne lokale justering er ret kraftig. En blødere overgang kan virke mere naturlig.', boundary: 'I den lille forhåndsvisning ændres justeringen brat ved maskekanten. En blødere overgang kan hjælpe.' },
  sv: { action: 'Mjuka upp kanter', explanation: 'Mjukar upp motivjusteringen utan att ändra originalet eller den målade masken. Kan ångras.', strong: 'Den lokala justeringen är ganska stark. En mjukare övergång kan se naturligare ut.', boundary: 'I den lilla förhandsvisningen ändras justeringen tvärt vid maskkanten. En mjukare övergång kan hjälpa.' },
  nb: { action: 'Myk opp kanter', explanation: 'Myker opp motivjusteringen uten å endre originalen eller den malte masken. Kan angres.', strong: 'Denne lokale justeringen er ganske sterk. En mykere overgang kan se mer naturlig ut.', boundary: 'I den lille forhåndsvisningen endres justeringen brått ved maskekanten. En mykere overgang kan hjelpe.' },
  fi: { action: 'Pehmennä reunoja', explanation: 'Pehmentää kohteen säätöä muuttamatta alkuperäistä tai maalattua maskia. Voit kumota muutoksen.', strong: 'Paikallinen säätö on melko voimakas. Pehmeämpi siirtymä voi näyttää luonnollisemmalta.', boundary: 'Pienessä esikatselussa säätö muuttuu jyrkästi maskin reunalla. Pehmeämpi siirtymä voi auttaa.' },
};
export const maskBlendLabels: Copy = translations[language] ?? en;
