import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese. DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  whereTaken: "Onde foram tiradas estas fotos?",
  whereTakenHint: "Os nomes das espécies são comparados com os animais que existem lá. Só se aplica a este projeto.",
  home: (region: string) => `Região habitual (${region})`,
  worldwide: "Todo o mundo",
  regionsHeading: "Regiões",
  countriesHeading: "Países",
  homeSetting: "Região habitual",
  homeSettingHint: "Onde costuma fotografar. Os projetos comparam os nomes das espécies com esta região, a menos que escolha outro local.",
  matchedIn: (area: string) => `Lista de espécies usada: ${area}`,
  promptOutside: (name: string) => `Algumas fotos parecem espécies de fora da sua região habitual, como ${name}.`,
  suggestionPrivacy: "Lido dos ficheiros neste dispositivo. As localizações não são enviadas para lado nenhum.",
  usePhotosPlace: (area: string) => `Localizações das fotos: ${area}`,
  notNow: "Agora não",
  changed: (area: string) => `Os nomes das espécies vêm agora de: ${area}. As fotos que não nomeou são analisadas de novo.`,
  promptGps: "As localizações destas fotos ficam fora da sua região habitual.",
  regions: {
    palearctic: "Europa, Norte de África e Norte da Ásia",
    nearctic: "América do Norte",
    neotropics: "América Central e do Sul",
    afrotropics: "África a sul do Sara",
    oriental: "Sul e Sudeste Asiático",
    australasia: "Austrália, Nova Guiné e Nova Zelândia",
    oceans: "Oceanos, ilhas e mares polares",
  },
};
