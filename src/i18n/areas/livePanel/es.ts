import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  open: `Sesión en directo`,
  openHint: `Inicie una sesión en directo: las fotos llegan a este proyecto mientras dispara.`,
  title: `Sesión en directo`,
  intro: `Las fotos llegan a este proyecto mientras dispara. No se cambia nada en la cámara ni en la carpeta. Aún no se ha probado con una cámara real.`,
  source: `De dónde vienen las fotos`,
  folder: `Una carpeta`,
  folderHint: `Una aplicación de captura u otro programa guarda las fotos en una carpeta que usted elige.`,
  ftpHint: `La cámara envía cada foto a este ordenador por la red local.`,
  usbHint: `Una función en prueba: solo se ha probado con una cámara simulada.`,
  look: `Estilo para las próximas fotos`,
  lookNone: `Ninguno: las fotos llegan tal como se tomaron`,
  lookNote: `Cada foto nueva recibe este estilo como su propia edición. Estilos › Ninguno o Restablecer lo quita. El archivo original nunca se modifica.`,
  room: `Mostrar en otras pantallas de esta red`,
  roomNote: `La tableta de un cliente o una pantalla del estudio puede ver las fotos y añadir estrellas y selecciones. Sus propias marcas siempre mandan.`,
  start: `Iniciar sesión en directo`,
  stop: `Detener sesión en directo`,
  close: `Cerrar y detener`,
  closeNote: `Al cerrar este panel se detiene la sesión en directo y se apagan la bandeja de la cámara y la sala.`,
  running: (n: number) => plural(n, { one: `Sesión en directo en curso · ${n} foto hasta ahora`, other: `Sesión en directo en curso · ${n} fotos hasta ahora` }),
  lookOn: (name: string) => `Estilo para las próximas fotos: ${name}`,
  ftpSame: `Estos datos son siempre los mismos en este ordenador, así la cámara conserva sus ajustes.`,
  portChanged: (port: number) => `El puerto habitual estaba ocupado, así que esta sesión usa el puerto ${port}. Escríbalo en la cámara, o cierre el otro programa y vuelva a empezar.`,
  newPassword: `Crear una contraseña nueva`,
  newPasswordNote: `Después escriba la contraseña nueva en la cámara.`,
  roomHeading: `Abra esta dirección en la otra pantalla`,
  starting: `Iniciando…`,
};
