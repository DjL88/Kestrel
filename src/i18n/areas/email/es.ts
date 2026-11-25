import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish. DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} te ha invitado a «${project}» en InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} te ha invitado al proyecto de InFlight «${project}» ${as}.`,
    as: { editor: "como editor", commenter: "como comentarista", viewer: "como lector", client: "como cliente" },
    join: "Para unirte, abre InFlight e inicia sesión con esta dirección de correo.",
    open: "Abrir InFlight",
    ignore: "¿No lo esperabas? Puedes ignorarlo. No pasa nada si no aceptas.",
    stop: "No recibir más correos de InFlight en esta dirección",
    someone: "Alguien",
  },
  unsubscribe: {
    title: "No recibir más correos de InFlight",
    confirm: "Pulsa el botón para no recibir más correos de InFlight en esta dirección.",
    button: "No recibir más correos",
    done: "Hecho. InFlight no enviará más correos a esta dirección.",
    invalid: "Este enlace no es válido.",
    invalidHint: "Responde al correo y dejaremos de enviarlas.",
  },
  news: {
    why: "Recibes esto porque pediste las novedades de InFlight por correo electrónico. Para dejar de recibirlas, desactívalo en Ajustes → Cuenta o usa el enlace de abajo.",
  },
};
