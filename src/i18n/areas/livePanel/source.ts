import { plural } from '../../../core/locale';

/**
 * The Live shoot panel (desktop app, preview): one place to start a live shoot from camera Wi-Fi, a folder or USB, with a
 * next-capture look and the client room. British English, the source for every translation. The FTP and room words it
 * shares with the filmstrip stay in the v2 area (liveShoot).
 */
export const source = {
  open: `Live shoot`,
  openHint: `Start a live shoot: frames arrive in this project as you take them.`,
  title: `Live shoot`,
  intro: `Frames arrive in this project as you take them. Nothing on the camera or in the folder is changed. Not yet tested with a real camera.`,
  source: `Where frames come from`,
  folder: `A folder`,
  folderHint: `A tether app or another program saves frames into a folder you choose.`,
  ftpHint: `The camera sends each frame to this computer over the local network.`,
  usbHint: `A preview: tried only with a simulated camera so far.`,
  look: `Next capture look`,
  lookNone: `None: frames arrive as shot`,
  lookNote: `Each new frame gets this look as its own edit. Looks › None or Reset takes it off. The original file is never changed.`,
  room: `Show on other screens on this network`,
  roomNote: `A client's tablet or a studio screen can see the frames and add stars and picks. Your own marks always win.`,
  start: `Start live shoot`,
  stop: `Stop live shoot`,
  close: `Close and stop`,
  closeNote: `Closing this panel stops the live shoot and switches the camera inbox and the room off.`,
  running: (n: number) => plural(n, { one: `Live shoot running · ${n} frame so far`, other: `Live shoot running · ${n} frames so far` }),
  lookOn: (name: string) => `Next capture look: ${name}`,
  ftpSame: `These stay the same each time on this computer, so the camera keeps its settings.`,
  portChanged: (port: number) => `The usual port was in use, so this shoot uses port ${port}. Type it into the camera, or close the other program and start again.`,
  newPassword: `Make a new password`,
  newPasswordNote: `Then type the new password into the camera.`,
  roomHeading: `Open this address on the other screen`,
  starting: `Starting…`,
};
