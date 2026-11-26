import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  welcome: {
    title: "Le damos la bienvenida a InFlight",
    intro: "Tres cosas que conviene saber antes de empezar:",
    originals: "Sus fotos originales se quedan donde están. InFlight nunca las cambia, mueve ni sustituye.",
    undo: "Cada edición se puede deshacer. InFlight guarda una receta de sus cambios, no una copia nueva de la foto.",
    backup: "Una copia de seguridad del proyecto guarda sus decisiones, valoraciones y ediciones, pero no los archivos RAW. Haga también copia de sus originales.",
    webNote: "En un navegador web, InFlight pedirá al navegador que conserve su almacenamiento cuando continúe. Puede ver qué significa en Ajustes, en Almacenamiento.",
    done: "Entendido",
  },
  browserStorage: {
    title: "Almacenamiento de este navegador",
    checking: "Comprobando qué conserva este navegador…",
    standard: "Este navegador puede borrar el almacenamiento de InFlight cuando falte espacio o se borren los datos del sitio.",
    requesting: "Pidiendo al navegador que conserve el almacenamiento de InFlight…",
    persistent: "Este navegador ha aceptado conservar el almacenamiento de InFlight. Si borra usted los datos del sitio, se eliminará igualmente.",
    declined: "El navegador no ha aceptado conservar el almacenamiento de InFlight. Lo decide él, a menudo según cuánto use el sitio. Puede volver a pedirlo más tarde.",
    unavailable: "Este navegador no puede garantizar que conserve el almacenamiento de InFlight.",
    ask: "Pedir al navegador que conserve el almacenamiento",
    kept: "El almacenamiento se conserva",
    permissionsTitle: "Permisos de archivos",
    permissions: "El navegador solo deja a InFlight leer las fotos y carpetas que usted elija. Tras cerrar la pestaña o reiniciar, puede volver a pedirle permiso antes de que InFlight vea una carpeta. Decir que no no daña sus fotos; InFlight simplemente no puede mostrarlas hasta que lo permita.",
    forgetTitle: "Lo que el navegador puede olvidar",
    forget: "Sus proyectos, decisiones, ediciones y vistas previas se guardan en este navegador. Borrar los datos de navegación, usar una ventana privada o desinstalar el navegador puede eliminarlos. Sus fotos originales nunca se guardan ni se cambian aquí, así que están a salvo.",
    backupHint: "Por seguridad, haga una copia del proyecto desde sus opciones y guárdela, con sus originales, fuera de este navegador.",
  },
};
