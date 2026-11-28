import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese (European). DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  open: `Sessão em direto`,
  openHint: `Inicie uma sessão em direto: as fotografias chegam a este projeto enquanto fotografa.`,
  title: `Sessão em direto`,
  intro: `As fotografias chegam a este projeto enquanto fotografa. Nada é alterado na câmara nem na pasta. Ainda não foi testado com uma câmara real.`,
  source: `De onde vêm as fotografias`,
  folder: `Uma pasta`,
  folderHint: `Uma aplicação de captura ou outro programa guarda as fotografias numa pasta à sua escolha.`,
  ftpHint: `A câmara envia cada fotografia para este computador pela rede local.`,
  usbHint: `Uma pré-visualização: até agora só experimentada com uma câmara simulada.`,
  look: `Estilo para as próximas fotografias`,
  lookNone: `Nenhum: as fotografias chegam como foram tiradas`,
  lookNote: `Cada nova fotografia recebe este estilo como edição própria. Estilos › Nenhum ou Repor retira-o. O ficheiro original nunca é alterado.`,
  room: `Mostrar noutros ecrãs desta rede`,
  roomNote: `O tablet de um cliente ou um ecrã do estúdio pode ver as fotografias e acrescentar estrelas e escolhas. As suas próprias marcas prevalecem sempre.`,
  start: `Iniciar sessão em direto`,
  stop: `Parar sessão em direto`,
  close: `Fechar e parar`,
  closeNote: `Fechar este painel para a sessão em direto e desliga a caixa de entrada da câmara e a sala.`,
  running: (n: number) => plural(n, { one: `Sessão em direto a decorrer · ${n} fotografia até agora`, other: `Sessão em direto a decorrer · ${n} fotografias até agora` }),
  lookOn: (name: string) => `Estilo para as próximas fotografias: ${name}`,
  ftpSame: `Estes dados ficam iguais de cada vez neste computador, por isso a câmara mantém as suas definições.`,
  portChanged: (port: number) => `A porta habitual estava ocupada, por isso esta sessão usa a porta ${port}. Escreva-a na câmara, ou feche o outro programa e comece de novo.`,
  newPassword: `Criar uma nova palavra-passe`,
  newPasswordNote: `Depois escreva a nova palavra-passe na câmara.`,
  roomHeading: `Abra este endereço no outro ecrã`,
  starting: `A iniciar…`,
};
