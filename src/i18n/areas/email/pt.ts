import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese. DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} convidou-o para «${project}» no InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} convidou-o para o projeto InFlight «${project}» ${as}.`,
    as: { editor: "como editor", commenter: "como comentador", viewer: "como observador", client: "como cliente" },
    join: "Para participar, abra o InFlight e inicie sessão com este endereço de email.",
    open: "Abrir o InFlight",
    ignore: "Não estava à espera? Pode ignorar. Nada acontece se não aceitar.",
    stop: "Não receber mais emails do InFlight neste endereço",
    someone: "Alguém",
  },
  unsubscribe: {
    title: "Não receber mais emails do InFlight",
    confirm: "Prima o botão para não receber mais emails do InFlight neste endereço.",
    button: "Não receber mais emails",
    done: "Feito. O InFlight não enviará mais emails para este endereço.",
    invalid: "Esta ligação não é válida.",
    invalidHint: "Responda ao email e deixaremos de os enviar.",
  },
  news: {
    why: "Recebe isto porque pediu as novidades do InFlight por e-mail. Para parar, desative em Definições → Conta, ou use a ligação abaixo.",
  },
};
