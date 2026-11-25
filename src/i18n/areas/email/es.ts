import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish. DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} te ha invitado a «${project}» en InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} te ha invitado al proyecto de InFlight «${project}» ${as}.`,
    as: { editor: "como editor", commenter: "como comentarista", viewer: "como lector", client: "como cliente" },
    join: "Para unirse, abra InFlight e inicie sesión con esta dirección de correo.",
    open: "Abrir InFlight",
    ignore: "¿No lo esperaba? Puede ignorarlo. No pasa nada si no acepta.",
    stop: "No recibir más correos de InFlight en esta dirección",
    someone: "Alguien",
  },
  unsubscribe: {
    title: "No recibir más correos de InFlight",
    confirm: "Pulse el botón para no recibir más correos de InFlight en esta dirección.",
    button: "No recibir más correos",
    done: "Hecho. InFlight no enviará más correos a esta dirección.",
    invalid: "Este enlace no es válido.",
    invalidHint: "Responda al correo y dejaremos de enviarle mensajes.",
  },
};
