export type PermissaoEvento = 'admin_evento' | 'operador' | 'checkin';

export type EventoPermissoes = {
  podeFinanceiro: boolean;
  podeEditarEvento: boolean;
  podeCriarEquipe: boolean;
  podeBackup: boolean;
  podeRelatorios: boolean;
  podeComunicacao: boolean;
  podeCertificados: boolean;
  podeHospedagem: boolean;
  podeProgramacao: boolean;
  podeEditarInscricoes: boolean;
  podeRemoverInscricao: boolean;
  podeMoverInscricao: boolean;
  somenteCheckin: boolean;
};

export function resolveEventoPermissoes(opts: {
  perm: PermissaoEvento | null;
  isGlobal: boolean;
  isDeptAdmin: boolean;
}): EventoPermissoes {
  const isAdmin = opts.isGlobal || opts.isDeptAdmin || opts.perm === 'admin_evento';
  const isOperador = opts.perm === 'operador';
  const isCheckin = opts.perm === 'checkin';

  return {
    podeFinanceiro: isAdmin,
    podeEditarEvento: isAdmin,
    podeCriarEquipe: isAdmin,
    podeBackup: isAdmin,
    podeRelatorios: isAdmin || isOperador,
    podeComunicacao: isAdmin || isOperador,
    podeCertificados: isAdmin || isOperador,
    podeHospedagem: isAdmin || isOperador,
    podeProgramacao: isAdmin || isOperador,
    podeEditarInscricoes: isAdmin || isOperador,
    podeRemoverInscricao: isAdmin,
    podeMoverInscricao: isAdmin,
    somenteCheckin: !isAdmin && isCheckin,
  };
}
