export type EventoRole =
  | 'admin_evento'
  | 'operador'
  | 'checkin'
  | 'hospedagem'
  | 'checkin_hospedagem';

export type EventoArea =
  | 'inscricoes'
  | 'checkin'
  | 'etiquetas'
  | 'hospedagem'
  | 'hospedagem_checkin'
  | 'equipe'
  | 'configuracoes'
  | 'comunicacao'
  | 'financeiro'
  | 'backup'
  | 'certificados'
  | 'programacao'
  | 'relatorios'
  | 'relatorios_ago'
  | 'centro_controle'
  | 'dashboard_executivo';

export type EventoTabId =
  | 'inscritos'
  | 'checkin'
  | 'etiquetas'
  | 'hospedagem'
  | 'equipe'
  | 'configuracoes'
  | 'comunicacao'
  | 'financeiro'
  | 'backup'
  | 'certificados'
  | 'programacao'
  | 'relatorios';

export const EVENTO_PERMISSIONS: Record<EventoRole, Record<EventoArea, boolean>> = {
  admin_evento: {
    inscricoes: true,
    checkin: true,
    etiquetas: true,
    hospedagem: true,
    hospedagem_checkin: true,
    equipe: true,
    configuracoes: true,
    comunicacao: true,
    financeiro: true,
    backup: true,
    certificados: true,
    programacao: true,
    relatorios: true,
    relatorios_ago: true,
    centro_controle: true,
    dashboard_executivo: true,
  },
  operador: {
    inscricoes: true,
    checkin: true,
    etiquetas: true,
    hospedagem: false,
    hospedagem_checkin: false,
    equipe: false,
    configuracoes: false,
    comunicacao: true,
    financeiro: false,
    backup: false,
    certificados: true,
    programacao: true,
    relatorios: true,
    relatorios_ago: false,
    centro_controle: false,
    dashboard_executivo: false,
  },
  checkin: {
    inscricoes: false,
    checkin: true,
    etiquetas: false,
    hospedagem: false,
    hospedagem_checkin: false,
    equipe: false,
    configuracoes: false,
    comunicacao: false,
    financeiro: false,
    backup: false,
    certificados: false,
    programacao: false,
    relatorios: false,
    relatorios_ago: false,
    centro_controle: false,
    dashboard_executivo: false,
  },
  hospedagem: {
    inscricoes: false,
    checkin: false,
    etiquetas: false,
    hospedagem: true,
    hospedagem_checkin: true,
    equipe: false,
    configuracoes: false,
    comunicacao: false,
    financeiro: false,
    backup: false,
    certificados: false,
    programacao: false,
    relatorios: false,
    relatorios_ago: false,
    centro_controle: false,
    dashboard_executivo: false,
  },
  checkin_hospedagem: {
    inscricoes: false,
    checkin: false,
    etiquetas: false,
    hospedagem: false,
    hospedagem_checkin: true,
    equipe: false,
    configuracoes: false,
    comunicacao: false,
    financeiro: false,
    backup: false,
    certificados: false,
    programacao: false,
    relatorios: false,
    relatorios_ago: false,
    centro_controle: false,
    dashboard_executivo: false,
  },
};

export const EVENTO_TAB_TO_AREA: Record<EventoTabId, EventoArea> = {
  inscritos: 'inscricoes',
  checkin: 'checkin',
  etiquetas: 'etiquetas',
  hospedagem: 'hospedagem',
  equipe: 'equipe',
  configuracoes: 'configuracoes',
  comunicacao: 'comunicacao',
  financeiro: 'financeiro',
  backup: 'backup',
  certificados: 'certificados',
  programacao: 'programacao',
  relatorios: 'relatorios',
};

const DEFAULT_EVENTO_AREA: Record<EventoRole, EventoArea> = {
  admin_evento: 'inscricoes',
  operador: 'inscricoes',
  checkin: 'checkin',
  hospedagem: 'hospedagem',
  checkin_hospedagem: 'hospedagem_checkin',
};

export type EventoPermissoes = {
  podeFinanceiro: boolean;
  podeEditarEvento: boolean;
  podeCriarEquipe: boolean;
  podeConfiguracoes: boolean;
  podeBackup: boolean;
  podeRelatorios: boolean;
  podeRelatoriosAgo: boolean;
  podeCentroControle: boolean;
  podeDashboardExecutivo: boolean;
  podeComunicacao: boolean;
  podeCertificados: boolean;
  podeHospedagem: boolean;
  podeHospedagemCheckin: boolean;
  podeProgramacao: boolean;
  podeCheckin: boolean;
  podeEditarInscricoes: boolean;
  podeRemoverInscricao: boolean;
  podeMoverInscricao: boolean;
  somenteCheckin: boolean;
  somenteCheckinHospedagem: boolean;
};

export function isEventoRole(value: string | null | undefined): value is EventoRole {
  return value === 'admin_evento'
    || value === 'operador'
    || value === 'checkin'
    || value === 'hospedagem'
    || value === 'checkin_hospedagem';
}

export function normalizeEventoRole(value: string | null | undefined): EventoRole | null {
  if (!value) return null;
  if (isEventoRole(value)) return value;
  if (value === 'admin') return 'admin_evento';
  if (value === 'hospedagem_checkin') return 'checkin_hospedagem';
  return null;
}

export function getEventoPermissions(role: EventoRole | null | undefined): Record<EventoArea, boolean> | null {
  if (!role) return null;
  return EVENTO_PERMISSIONS[role] ?? null;
}

export function canAccessEventoArea(role: EventoRole | null | undefined, area: EventoArea): boolean {
  const permissions = getEventoPermissions(role);
  return permissions?.[area] === true;
}

export function assertEventoPermission(role: EventoRole | null | undefined, area: EventoArea): void {
  if (!canAccessEventoArea(role, area)) {
    throw new Error(`Acesso não autorizado para a área ${area}. Perfil atual: ${role ?? 'nenhum'}.`);
  }
}

export function getDefaultEventoArea(role: EventoRole | null | undefined): EventoArea | null {
  if (!role) return null;
  return DEFAULT_EVENTO_AREA[role] ?? null;
}

export function getDefaultEventoPath(eventoId: string, role: EventoRole | null | undefined): string {
  switch (getDefaultEventoArea(role)) {
    case 'checkin':
      return `/eventos/${eventoId}/checkin`;
    case 'hospedagem':
      return `/eventos/${eventoId}?tab=hospedagem`;
    case 'hospedagem_checkin':
      return `/eventos/${eventoId}/hospedagem/checkin`;
    case 'inscricoes':
    default:
      return `/eventos/${eventoId}`;
  }
}

export function getEventoTabsPermitidas(role: EventoRole | null | undefined): EventoTabId[] {
  if (!role) return [];
  return (Object.entries(EVENTO_TAB_TO_AREA) as Array<[EventoTabId, EventoArea]>)
    .filter(([, area]) => canAccessEventoArea(role, area))
    .map(([tabId]) => tabId);
}

export function resolveEventoPermissoes(opts: {
  perm: EventoRole | null;
  isGlobal: boolean;
  isDeptAdmin: boolean;
}): EventoPermissoes {
  const role: EventoRole | null = (opts.isGlobal || opts.isDeptAdmin)
    ? 'admin_evento'
    : opts.perm;

  const can = (area: EventoArea) => canAccessEventoArea(role, area);
  const isAdmin = role === 'admin_evento';

  return {
    podeFinanceiro: can('financeiro'),
    podeEditarEvento: isAdmin,
    podeCriarEquipe: can('equipe'),
    podeConfiguracoes: can('configuracoes'),
    podeBackup: can('backup'),
    podeRelatorios: can('relatorios'),
    podeRelatoriosAgo: can('relatorios_ago'),
    podeCentroControle: can('centro_controle'),
    podeDashboardExecutivo: can('dashboard_executivo'),
    podeComunicacao: can('comunicacao'),
    podeCertificados: can('certificados'),
    podeHospedagem: can('hospedagem'),
    podeHospedagemCheckin: can('hospedagem_checkin'),
    podeProgramacao: can('programacao'),
    podeCheckin: can('checkin'),
    podeEditarInscricoes: can('inscricoes'),
    podeRemoverInscricao: isAdmin,
    podeMoverInscricao: isAdmin,
    somenteCheckin: role === 'checkin',
    somenteCheckinHospedagem: role === 'checkin_hospedagem',
  };
}