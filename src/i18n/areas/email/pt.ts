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
    stopNews: "Deixar de receber novidades do InFlight por email",
    stopNotices: "Deixar de receber emails sobre os seus projetos partilhados",
    confirmNews: "Prima o botão para deixar de receber novidades do InFlight por email. Os emails da sua conta, como uma chave de licença, continuam a chegar.",
    confirmNotices: "Prima o botão para deixar de receber emails sobre os seus projetos partilhados. Continua a vê-los na aplicação.",
    doneNews: "Feito. Para voltar a receber novidades por email, abra Definições → Conta no InFlight.",
    doneNotices: "Feito. Para voltar a receber estes emails, abra Definições → Conta no InFlight.",
  },
  news: {
    why: "Recebe isto porque pediu as novidades do InFlight por e-mail. Para parar, desative em Definições → Conta, ou use a ligação abaixo.",
  },
};
