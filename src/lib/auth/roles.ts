export type CanonicalRole = 'super' | 'administrador' | 'cgadb' | 'comissao' | 'inscricao' | 'financeiro';

export type ModuleKey =
  | 'cgadb'
  | 'secretaria'
  | 'financeiro'
  | 'usuarios'
  | 'auditoria'
  | 'comissao'
  | 'missoes'
  | 'membros'
  | 'funcionarios'
  | 'documentos'
  | 'permutas'
  | 'eventos'
  | 'configuracoes';

export type ApiKey = 'financeiro' | 'members' | 'employees' | 'documentos' | 'permutas';

const CANONICAL_ROLES = new Set<CanonicalRole>([
  'super',
  'administrador',
  'cgadb',
  'comissao',
  'inscricao',
  'financeiro',
]);

const ROLE_ALIASES: Record<string, CanonicalRole> = {
  super_admin: 'super',
  superadmin: 'super',
  superuser: 'super',
  super_user: 'super',
  admin: 'administrador',
  administrator: 'administrador',
  administrador: 'administrador',
  manager: 'administrador',
  supervisor: 'administrador',
  superintendente: 'administrador',
  superintendent: 'administrador',
  coordenador: 'administrador',
  coordinator: 'administrador',
  operator: 'administrador',
  viewer: 'administrador',
  cgadb: 'cgadb',
  comissao: 'comissao',
  inscricao: 'inscricao',
  financeiro: 'financeiro',
  financial: 'financeiro',
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeRole(value: string | null | undefined): CanonicalRole | null {
  const key = normalizeKey(String(value || ''));
  if (!key) return null;
  if (CANONICAL_ROLES.has(key as CanonicalRole)) return key as CanonicalRole;
  return ROLE_ALIASES[key] ?? null;
}

function normalizeRoleList(value: string | readonly string[] | null | undefined): CanonicalRole[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const roles: CanonicalRole[] = [];
  for (const item of list) {
    const normalized = normalizeRole(item);
    if (normalized) roles.push(normalized);
  }
  return roles;
}

export function hasRole(
  value: string | readonly string[] | null | undefined,
  required: CanonicalRole | readonly CanonicalRole[]
): boolean {
  const userRoles = normalizeRoleList(value);
  if (userRoles.includes('super')) return true;

  const requiredList = Array.isArray(required) ? required : [required];
  const requiredRoles: CanonicalRole[] = [];
  for (const item of requiredList) {
    const normalized = normalizeRole(item);
    if (normalized) requiredRoles.push(normalized);
  }

  return requiredRoles.some((role) => userRoles.includes(role));
}

const MODULE_ACCESS: Record<ModuleKey, CanonicalRole[]> = {
  cgadb: ['super', 'administrador', 'cgadb'],
  secretaria: ['super', 'administrador', 'comissao'],
  financeiro: ['super', 'financeiro'],
  usuarios: ['super'],
  auditoria: ['super'],
  comissao: ['super', 'administrador', 'comissao'],
  missoes: ['super', 'administrador', 'comissao'],
  membros: ['super', 'administrador', 'comissao'],
  funcionarios: ['super', 'administrador'],
  documentos: ['super', 'administrador'],
  permutas: ['super', 'administrador', 'financeiro'],
  eventos: ['super', 'administrador', 'inscricao'],
  configuracoes: ['super', 'administrador'],
};

const API_ACCESS: Record<ApiKey, CanonicalRole[]> = {
  financeiro: ['super', 'financeiro'],
  members: ['super', 'administrador', 'comissao'],
  employees: ['super', 'administrador'],
  documentos: ['super', 'administrador'],
  permutas: ['super', 'administrador', 'financeiro'],
};

export function canAccessModule(role: CanonicalRole | null, moduleKey: ModuleKey): boolean {
  if (!role) return false;
  return hasRole(role, MODULE_ACCESS[moduleKey]);
}

export function canAccessApi(role: CanonicalRole | null, apiKey: ApiKey): boolean {
  if (!role) return false;
  return hasRole(role, API_ACCESS[apiKey]);
}
