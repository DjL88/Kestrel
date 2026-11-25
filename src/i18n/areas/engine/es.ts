import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Balance de blancos', temperature: 'Temperatura', tint: 'Matiz', exposure: 'Exposición', contrast: 'Contraste',
    highlights: 'Iluminaciones', shadows: 'Sombras', whites: 'Blancos', blacks: 'Negros', toneCurve: 'Curva de tonos',
    vibrance: 'Intensidad', saturation: 'Saturación', colourMixer: 'Mezclador de color', clarity: 'Claridad', detailRecovery: 'Textura',
    sharpen: 'Nitidez', denoiseLuminance: 'Ruido de luminancia', denoiseColour: 'Ruido de color', upscaleFactor: 'Ampliar',
    masks: 'Ajustes locales',
  },
  notMeasured: 'Sin medir',
  notRecorded: 'No registrado',
  suggestedName: (name) => `${name} (sugerido)`,
  subjectKinds: { wildlife: 'Fauna', people: 'Personas', landscape: 'Paisaje', other: 'Otro motivo' },
  auto: {
    ready: 'Hay sugerencias de edición comprobadas listas para previsualizar.',
    noneDifferent: 'Ninguna edición visiblemente distinta superó las comprobaciones.',
    appliedGentler: 'Auto aplicó una versión más suave: la completa no superó un control de seguridad.',
    applied: 'Auto aplicado. Ajuste la intensidad a su gusto o deshágalo.',
    looksGood: 'Se ve bien: los valores medidos están dentro del rango, así que no se cambió nada.',
    cannotImprove: 'No se puede mejorar con seguridad, así que no se cambió nada.',
    withheld: 'Se retuvo una edición sugerida porque no superó una comprobación.',
    multipleSubjects: 'Cada motivo se comprobó por separado para ver si perdía luces o sombras. Se retuvo la corrección de color por especie.',
    coverageUnavailable: 'No se pudo delimitar cada motivo, así que solo se consideraron sugerencias para toda la foto.',
    speciesReference: (features) => `Referencia de la especie (una guía, no un color medido): ${features}`,
  },
  deepReview: {
    none: 'Revisión a fondo: no se encontró en esta foto ningún motivo en el que el detector confíe.',
    confidence: { high: 'alta', medium: 'media', low: 'baja' },
    sharpness: { subjectSharp: 'nítido', subjectOk: 'bastante nítido', subjectSoft: 'borroso', noSubject: 'poco claro', unavailable: 'poco claro' },
    trusted: (confidence, sharpness) => `Revisión a fondo: se encontró un motivo ${sharpness}, con confianza ${confidence}.`,
    untrusted: (sharpness) => `Revisión a fondo: se encontró un motivo demasiado ${sharpness} para fiarse.`,
    witness: { bird: 'ave', aircraft: 'avión', person: 'persona', animal: 'animal', vehicle: 'vehículo' },
    agreed: (subject) => `La lectura de la escena lo confirma: ${subject}.`,
    conflict: (reading, detector) => `La lectura de la escena no coincide: dice ${reading} y el detector dice ${detector}. Considérelo sin resolver.`,
    suggested: (name, description) => `Sugerencia: «${name}» – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'No se encontró ruido visible a tamaño completo, así que no se cambió nada.',
    protectionLost: 'Esta vez no se pudo proteger el motivo con seguridad. Se conservaron sus ediciones.',
    cloud: 'Ruido reducido en la nube de InFlight a partir de una copia de trabajo y comprobado en este dispositivo.',
    cloudNotUsed: 'Esta vez no se usó la nube, así que se procesó en este dispositivo.',
    device: 'Ruido reducido en este dispositivo.',
    layersFull: 'No todos los motivos pudieron tener su propia capa, así que se usó una capa de protección común.',
    protected: (count) => (count === 1
      ? 'Ruido reducido en este dispositivo, con el motivo protegido.'
      : `Ruido reducido en este dispositivo, con ${count} motivos protegidos juntos.`),
    global: 'Ningún contorno de motivo era fiable, así que la reducción de ruido se aplicó por igual a toda la foto.',
    failedCheck: 'El resultado no superó el control de calidad. Se conservaron sus ediciones.',
    leftAsItWas: (notes) => `Se dejó como estaba. ${notes}`,
  },
};
