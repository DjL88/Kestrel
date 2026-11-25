import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** European Portuguese. DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Equilíbrio de brancos', temperature: 'Temperatura', tint: 'Tonalidade', exposure: 'Exposição', contrast: 'Contraste',
    highlights: 'Realces', shadows: 'Sombras', whites: 'Brancos', blacks: 'Pretos', toneCurve: 'Curva de tons',
    vibrance: 'Vibração', saturation: 'Saturação', colourMixer: 'Misturador de cores', clarity: 'Claridade', detailRecovery: 'Textura',
    sharpen: 'Nitidez', denoiseLuminance: 'Ruído de luminância', denoiseColour: 'Ruído de cor', upscaleFactor: 'Ampliar',
    masks: 'Ajustes locais',
  },
  notMeasured: 'Não medido',
  notRecorded: 'Não registado',
  suggestedName: (name) => `${name} (sugerido)`,
  subjectKinds: { wildlife: 'Vida selvagem', people: 'Pessoas', landscape: 'Paisagem', other: 'Outro motivo' },
  auto: {
    ready: 'Há sugestões de edição verificadas prontas a pré-visualizar.',
    noneDifferent: 'Nenhuma edição visivelmente diferente passou as verificações.',
    appliedGentler: 'O Auto aplicou uma versão mais suave: a completa falhou uma verificação de segurança.',
    applied: 'Auto aplicado. Ajuste a intensidade a seu gosto, ou anule.',
    looksGood: 'Está bem: os valores medidos estão dentro do intervalo, por isso nada foi alterado.',
    cannotImprove: 'Não é possível melhorar com segurança, por isso nada foi alterado.',
    withheld: 'Uma edição sugerida foi retida porque falhou uma verificação.',
    multipleSubjects: 'Cada motivo foi verificado em separado quanto a realces e sombras perdidos. A correção de cor por espécie foi retida.',
    coverageUnavailable: 'Não foi possível delimitar todos os motivos, por isso só foram consideradas sugestões para a fotografia inteira.',
    speciesReference: (features) => `Referência da espécie (um guia, não uma cor medida): ${features}`,
  },
  deepReview: {
    none: 'Revisão aprofundada: não foi encontrado nesta fotografia nenhum motivo em que o detetor confie.',
    confidence: { high: 'alta', medium: 'média', low: 'baixa' },
    sharpness: { subjectSharp: 'nítido', subjectOk: 'razoavelmente nítido', subjectSoft: 'desfocado', noSubject: 'pouco claro', unavailable: 'pouco claro' },
    trusted: (confidence, sharpness) => `Revisão aprofundada: encontrado um motivo ${sharpness}, com confiança ${confidence}.`,
    untrusted: (sharpness) => `Revisão aprofundada: encontrado um motivo demasiado ${sharpness} para confiar.`,
    witness: { bird: 'ave', aircraft: 'avião', person: 'pessoa', animal: 'animal', vehicle: 'veículo' },
    agreed: (subject) => `A leitura da cena confirma: ${subject}.`,
    conflict: (reading, detector) => `A leitura da cena discorda: diz ${reading}, o detetor diz ${detector}. Considere isto por resolver.`,
    suggested: (name, description) => `Sugestão: «${name}» – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Não foi encontrado ruído visível em tamanho real, por isso nada foi alterado.',
    protectionLost: 'Desta vez não foi possível proteger o motivo com segurança. As suas edições foram mantidas.',
    cloud: 'Ruído reduzido na nuvem InFlight a partir de uma cópia de trabalho e verificado neste dispositivo.',
    cloudNotUsed: 'Desta vez a nuvem não foi usada, por isso correu neste dispositivo.',
    device: 'Ruído reduzido neste dispositivo.',
    layersFull: 'Nem todos os motivos puderam ter a sua própria camada, por isso foi usada uma camada de proteção comum.',
    protected: (count) => (count === 1
      ? 'Ruído reduzido neste dispositivo, com o motivo protegido.'
      : `Ruído reduzido neste dispositivo, com ${count} motivos protegidos em conjunto.`),
    global: 'Nenhum contorno de motivo era fiável, por isso a redução de ruído foi aplicada por igual a toda a fotografia.',
    failedCheck: 'O resultado não passou a verificação de qualidade. As suas edições foram mantidas.',
    leftAsItWas: (notes) => `Ficou como estava. ${notes}`,
  },
};
