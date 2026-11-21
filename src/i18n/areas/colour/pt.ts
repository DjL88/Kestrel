import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** European Portuguese. DRAFT: written without a native speaker's check. Colour names sit in brackets or after "em". */
export const pt: AreaTranslation<typeof source> = {
  title: 'Verificação de cor',
  intro: 'O Kestrel indica por palavras as cores desta fotografia e assinala tudo o que possa parecer errado.',
  checking: 'A verificar a cor…',
  unavailable: 'A verificação de cor ainda não está disponível para esta fotografia.',
  mainColours: 'Cores principais',
  nothingToFix: 'Nada parece errado na cor desta pequena pré-visualização.',
  watchOut: 'Atenção:',
  tip: 'Dica:',
  note: 'Nota:',
  family: {
    red: 'vermelho', orange: 'laranja', brown: 'castanho', yellow: 'amarelo', lime: 'amarelo-esverdeado', green: 'verde', teal: 'verde-azulado',
    blue: 'azul', purple: 'roxo', pink: 'cor-de-rosa', grey: 'cinzento', black: 'preto', white: 'branco',
  },
  strength: { none: 'sem cor', muted: 'suave', moderate: 'médio', strong: 'forte', veryStrong: 'muito forte' },
  share: (percent) => (percent >= 45 ? 'cerca de metade ou mais' : percent >= 25 ? 'cerca de um quarto ou mais' : percent >= 10 ? 'uma boa parte' : 'um pouco'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} e ${second}`,
  strongColour: (colours, percent) => `Uma cor muito intensa (${colours}) cobre ${percent}% da fotografia. Pode parecer irreal no ecrã e ficar mal na impressão.`,
  clippedColour: (colours) => `Algumas zonas em ${colours} são intensas demais para mostrar o pormenor, por isso parecem planas.`,
  cast: {
    warm: 'O que devia ser cinzento ou branco parece um pouco amarelo ou laranja (um tom quente).',
    cool: 'O que devia ser cinzento ou branco parece um pouco azul (um tom frio).',
    green: 'O que devia ser cinzento ou branco parece um pouco verde.',
    magenta: 'O que devia ser cinzento ou branco parece um pouco cor-de-rosa ou roxo.',
  },
  castClear: 'O tom é evidente o suficiente para a maioria das pessoas reparar.',
  muted: 'Esta fotografia quase não tem cor. Não faz mal se a quiser quase a preto e branco.',
  redGreen: (first, second) => `As zonas em ${first} e em ${second} têm um brilho parecido, por isso muitas pessoas daltónicas vão ter dificuldade em distingui-las.`,
  redGreenHint: 'Tornar uma delas mais clara ou mais escura ajuda toda a gente a ver a diferença.',
  subject: (subjectColour, strength, surroundings) => `O seu motivo: ${subjectColour}, ${strength}. À volta: sobretudo ${surroundings}.`,
  editStronger: (percent) => `A sua edição tornou as cores ${percent}% mais intensas do que no original.`,
  editWeaker: (percent) => `A sua edição tornou as cores ${percent}% mais suaves do que no original.`,
  fixSoften: 'Suavizar a cor',
  fixCooler: 'Tornar mais frio',
  fixWarmer: 'Tornar mais quente',
  fixApplied: 'Feito. Pode anulá-lo no histórico de edições.',
  findings: (count) => plural(count, { one: `${count} coisa a verificar`, other: `${count} coisas a verificar` }),
};
