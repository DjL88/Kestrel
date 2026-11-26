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
    stopNews: "Dejar de recibir noticias de InFlight por correo",
    stopNotices: "Dejar de recibir correos sobre sus proyectos compartidos",
    confirmNews: "Pulse el botón para dejar de recibir noticias de InFlight por correo. Los correos de su cuenta, como una clave de licencia, seguirán llegando.",
    confirmNotices: "Pulse el botón para dejar de recibir correos sobre sus proyectos compartidos. Seguirá viéndolos en la aplicación.",
    doneNews: "Hecho. Para volver a recibir noticias por correo, abra Ajustes → Cuenta en InFlight.",
    doneNotices: "Hecho. Para volver a recibir estos correos, abra Ajustes → Cuenta en InFlight.",
  },
  news: {
    why: "Recibes esto porque pediste las novedades de InFlight por correo electrónico. Para dejar de recibirlas, desactívalo en Ajustes → Cuenta o usa el enlace de abajo.",
  },
};
