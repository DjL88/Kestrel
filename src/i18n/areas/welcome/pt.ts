import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese. DRAFT: written without a native speaker's check. */
export const pt: AreaTranslation<typeof source> = {
  welcome: {
    title: "Bem-vindo ao InFlight",
    intro: "Três coisas a saber antes de começar:",
    originals: "As suas fotografias originais ficam onde estão. O InFlight nunca as altera, move ou substitui.",
    undo: "Todas as edições podem ser anuladas. O InFlight guarda uma receita das suas alterações, não uma nova cópia da fotografia.",
    backup: "Uma cópia de segurança do projeto guarda as suas decisões, classificações e edições, mas não os ficheiros RAW. Faça também cópia dos originais.",
    webNote: "Num navegador web, o InFlight vai pedir ao navegador que guarde o seu armazenamento quando continuar. Pode ver o que isso significa em Definições, em Armazenamento.",
    done: "Entendi",
  },
  browserStorage: {
    title: "Armazenamento deste navegador",
    checking: "A verificar o que este navegador guarda…",
    standard: "Este navegador pode apagar o armazenamento do InFlight quando faltar espaço ou quando os dados do site forem apagados.",
    requesting: "A pedir ao navegador que guarde o armazenamento do InFlight…",
    persistent: "Este navegador aceitou guardar o armazenamento do InFlight. Se apagar os dados do site manualmente, ele é removido na mesma.",
    declined: "O navegador não aceitou guardar o armazenamento do InFlight. É ele que decide, muitas vezes conforme o uso que faz do site. Pode voltar a pedir mais tarde.",
    unavailable: "Este navegador não pode garantir que guarda o armazenamento do InFlight.",
    ask: "Pedir ao navegador que guarde o armazenamento",
    kept: "O armazenamento está guardado",
    permissionsTitle: "Permissões de ficheiros",
    permissions: "O navegador só deixa o InFlight ler as fotografias e pastas que escolher. Depois de fechar o separador ou reiniciar, pode voltar a pedir autorização antes de o InFlight ver uma pasta. Dizer que não não prejudica as fotografias; o InFlight apenas não as consegue mostrar até que o permita.",
    forgetTitle: "O que o navegador pode esquecer",
    forget: "Os seus projetos, decisões, edições e pré-visualizações ficam neste navegador. Apagar os dados de navegação, usar uma janela privada ou desinstalar o navegador pode removê-los. As fotografias originais nunca são guardadas nem alteradas aqui, por isso estão seguras.",
    backupHint: "Por segurança, faça uma cópia do projeto nas opções do projeto e guarde-a, com os originais, fora deste navegador.",
  },
  diskPreviews: {
    title: "Pré-visualizações neste computador",
    intro: "O InFlight guarda três imagens pequenas de cada foto RAW na sua própria pasta: uma miniatura, uma cópia de revisão e uma pré-visualização inteligente de 2560 px. Pode continuar a editar uma foto com o disco desligado. Para exportar continua a ser preciso o original. Os seus originais nunca são alterados.",
    using: "{used} em uso para {count} fotos.",
    checking: "A verificar a pasta das pré-visualizações…",
    limitLabel: "Tamanho máximo",
    limitDefault: "{size} (sugerido para este computador)",
    limitHint: "Cabem cerca de {count} fotos. Quando a pasta fica cheia, saem as pré-visualizações que não vê há mais tempo. Voltam a ser feitas quando abrir essas fotos com o disco ligado.",
    clear: "Remover todas as pré-visualizações",
    cleared: "Pré-visualizações removidas. Voltam a ser feitas quando vê as fotos.",
    failed: "Não foi possível ler a pasta das pré-visualizações.",
  },
};
