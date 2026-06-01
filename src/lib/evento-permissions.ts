export type PermissaoEvento =
  | 'admin_evento'
  | 'operador'
  | 'checkin'
  | 'hospedagem'
  | 'checkin_hospedagem';

export type AreaEvento =
  | 'inscricoes'
  | 'checkin'
  | 'etiquetas'
  | 'hospedagem'
  | 'hospedagem_checkin'
  | 'equipe'
  | 'comunicacao'
  | 'financeiro'
  | 'backup'
  | 'certificados'
  | 'programacao'
  | 'relatorios'
  | 'relatorios_ago'
  | 'centro_controle';

export function canAccessEventoArea(
  perfilEquipe: PermissaoEvento,
  area: AreaEvento
): boolean {
  if (perfilEquipe === 'admin_evento') return true;

  if (perfilEquipe === 'operador') {
    return [
      'inscricoes',
      'checkin',
      'etiquetas',
      'hospedagem',
      'hospedagem_checkin',
      'comunicacao',
      'certificados',
      'programacao',
      'relatorios',
    ].includes(area);
  }

  if (perfilEquipe === 'checkin') {
    return area === 'checkin';
  }

  if (perfilEquipe === 'hospedagem') {
    return area === 'hospedagem' || area === 'hospedagem_checkin';
  }

  if (perfilEquipe === 'checkin_hospedagem') {
    return area === 'hospedagem_checkin';
  }

  return false;
}

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
  const perfilBase: PermissaoEvento = isAdmin ? 'admin_evento' : (opts.perm ?? 'checkin');

  return {
    podeFinanceiro: isAdmin || canAccessEventoArea(perfilBase, 'financeiro'),
    podeEditarEvento: isAdmin,
    podeCriarEquipe: isAdmin || canAccessEventoArea(perfilBase, 'equipe'),
    podeBackup: isAdmin || canAccessEventoArea(perfilBase, 'backup'),
    podeRelatorios: isAdmin || canAccessEventoArea(perfilBase, 'relatorios'),
    podeComunicacao: isAdmin || canAccessEventoArea(perfilBase, 'comunicacao'),
    podeCertificados: isAdmin || canAccessEventoArea(perfilBase, 'certificados'),
    podeHospedagem: isAdmin || canAccessEventoArea(perfilBase, 'hospedagem'),
    podeProgramacao: isAdmin || canAccessEventoArea(perfilBase, 'programacao'),
    podeEditarInscricoes: isAdmin || canAccessEventoArea(perfilBase, 'inscricoes'),
    podeRemoverInscricao: isAdmin,
    podeMoverInscricao: isAdmin,
    somenteCheckin: !isAdmin && perfilBase === 'checkin',
  };
}
