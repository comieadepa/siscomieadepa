import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { logDB } from '@/lib/audit';
import { normalizeRole } from '@/lib/auth/roles';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import {
  canAccessEventoArea,
  normalizeEventoRole,
  resolveEventoPermissoes,
  type EventoArea,
  type EventoPermissoes,
  type EventoRole,
} from './evento-permissions';

type EventoRow = {
  id: string;
  departamento: string | null;
  status?: string | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  tipo: EventoRole;
  ativo: boolean;
  convite_expira_em?: string | null;
  local_id?: string | null;
};

export type EventoGuardContext = {
  user: User | null;
  equipe: EquipeRow | null;
  evento: EventoRow;
  role: EventoRole;
  permissao: EventoRole;
  source: 'global' | 'departamento' | 'usuario_evento' | 'equipe';
  perms: EventoPermissoes;
  supabaseAdmin: ReturnType<typeof createServerClient>;
};

type GuardDenied = { ok: false; response: NextResponse };
type GuardAllowed = { ok: true; ctx: EventoGuardContext };

async function extractEquipeIdFromRequest(request: NextRequest): Promise<string | null> {
  const byHeader = request.headers.get('x-evento-equipe-id');
  if (byHeader) return byHeader.trim() || null;

  const byQuery = request.nextUrl.searchParams.get('equipe_id') || request.nextUrl.searchParams.get('equipeId');
  if (byQuery) return byQuery.trim() || null;

  return null;
}

function deniedResponse(area: EventoArea, role: EventoRole | null, debug?: any): NextResponse {
  return NextResponse.json(
    {
      error: 'Acesso não autorizado para esta área do evento.',
      area,
      role,
      debug,
    },
    { status: 403 },
  );
}

async function logDeniedAccess(params: {
  request: NextRequest;
  eventoId: string;
  area: EventoArea;
  role: EventoRole | null;
  user: User | null;
  equipeId?: string | null;
  motivo: string;
}) {
  const detalhes = {
    evento_id: params.eventoId,
    area: params.area,
    role: params.role,
    rota: params.request.nextUrl.pathname,
    metodo: params.request.method,
    equipe_id: params.equipeId ?? null,
    motivo: params.motivo,
  };

  await Promise.all([
    logDB({
      userId: params.user?.id,
      userEmail: params.user?.email ?? undefined,
      acao: 'acesso_area_evento_negado',
      modulo: 'eventos',
      entidade: 'evento_permissoes',
      entidadeId: params.eventoId,
      descricao: `Acesso negado à área ${params.area}.`,
      status: 'erro',
      detalhes,
      request: params.request,
    }),
    logDB({
      userId: params.user?.id,
      userEmail: params.user?.email ?? undefined,
      acao: 'tentativa_api_negada',
      modulo: 'eventos',
      entidade: 'evento_api',
      entidadeId: params.eventoId,
      descricao: `Tentativa negada em ${params.request.nextUrl.pathname}.`,
      status: 'erro',
      detalhes,
      request: params.request,
    }),
  ]);
}

async function logGrantedAccess(params: {
  request: NextRequest;
  eventoId: string;
  area: EventoArea;
  role: EventoRole;
  user: User | null;
  equipeId?: string | null;
}) {
  const sensitiveAreas: EventoArea[] = ['financeiro', 'backup', 'relatorios_ago', 'centro_controle', 'dashboard_executivo', 'equipe'];
  if (!sensitiveAreas.includes(params.area)) return;

  await logDB({
    userId: params.user?.id,
    userEmail: params.user?.email ?? undefined,
    acao: 'acesso_area_evento_liberado',
    modulo: 'eventos',
    entidade: 'evento_permissoes',
    entidadeId: params.eventoId,
    descricao: `Acesso liberado à área ${params.area}.`,
    status: 'sucesso',
    detalhes: {
      evento_id: params.eventoId,
      area: params.area,
      role: params.role,
      rota: params.request.nextUrl.pathname,
      metodo: params.request.method,
      equipe_id: params.equipeId ?? null,
    },
    request: params.request,
  });
}

async function resolveAuthenticatedUser(request?: NextRequest): Promise<User | null> {
  // 1. Tentar ler sessão via cookies (@supabase/ssr padrão)
  try {
    const userClient = await createServerClientFromCookies();
    const { data: { user } } = await userClient.auth.getUser();
    if (user) return user;
  } catch {
    // Falha silenciosa nos cookies, tenta via Bearer token
  }

  // 2. Tentar ler via cabeçalho Authorization: Bearer
  if (request) {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const admin = createServerClient();
        const { data: { user } } = await admin.auth.getUser(token);
        if (user) return user;
      } catch {
        // Token inválido ou expirado
      }
    }
  }

  return null;
}

async function resolveUserRole(args: {
  supabaseAdmin: ReturnType<typeof createServerClient>;
  user: User;
  evento: EventoRow;
}): Promise<{ role: EventoRole; source: EventoGuardContext['source'] } | null> {
  const meta = args.user.user_metadata || {};
  const rawNivel = (meta.nivel || meta.role || args.user.app_metadata?.role) as string | undefined;
  let nivel = normalizeRole(rawNivel ?? '');
  const departamento = (meta.subcategoria as string | undefined) ?? '';

  // 1. Se nivel não está no user_metadata, busca na tabela public.users (fonte de verdade no banco)
  if (!nivel) {
    const { data: dbUser } = await args.supabaseAdmin
      .from('users')
      .select('role, is_active')
      .eq('id', args.user.id)
      .maybeSingle();

    if (dbUser?.is_active !== false && dbUser?.role) {
      nivel = normalizeRole(dbUser.role);
    }
  }

  const isGlobal = nivel === 'super' || nivel === 'administrador';
  if (isGlobal) {
    return { role: 'admin_evento', source: 'global' };
  }

  // 2. Permissão explícita concedida em usuario_eventos_permitidos (gestor administrativo do evento)
  const { data: permitido } = await args.supabaseAdmin
    .from('usuario_eventos_permitidos')
    .select('id')
    .eq('usuario_id', args.user.id)
    .eq('evento_id', args.evento.id)
    .maybeSingle();

  if (permitido) {
    return { role: 'admin_evento', source: 'usuario_evento' };
  }

  // 3. Subcategoria TODOS para operadores/administradores de departamento
  if (departamento === 'TODOS') {
    return { role: 'admin_evento', source: 'departamento' };
  }

  // 4. Fallback temporário por subcategoria (somente se não houver registros em usuario_eventos_permitidos)
  const { count } = await args.supabaseAdmin
    .from('usuario_eventos_permitidos')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', args.user.id);

  if ((count ?? 0) === 0 && departamento) {
    // Se subcategoria for exatamente o UUID do evento
    if (departamento === args.evento.id) {
      return { role: 'admin_evento', source: 'usuario_evento' };
    }
    // Se subcategoria for o nome de um departamento (AGO, UMADESPA, etc)
    if (args.evento.departamento === departamento) {
      return { role: 'admin_evento', source: 'departamento' };
    }
  }

  // 5. Papel específico em usuario_eventos
  const { data: vinculo } = await args.supabaseAdmin
    .from('usuario_eventos')
    .select('permissao')
    .eq('user_id', args.user.id)
    .eq('evento_id', args.evento.id)
    .maybeSingle();

  const role = normalizeEventoRole((vinculo as { permissao?: string | null } | null)?.permissao ?? null);
  return role ? { role, source: 'usuario_evento' } : null;
}

async function resolveEquipeRole(args: {
  supabaseAdmin: ReturnType<typeof createServerClient>;
  eventoId: string;
  equipeId: string;
}): Promise<{ role: EventoRole; equipe: EquipeRow; source: EventoGuardContext['source'] } | null> {
  const { data: equipe } = await args.supabaseAdmin
    .from('evento_equipe')
    .select('id,evento_id,tipo,ativo,convite_expira_em,local_id')
    .eq('id', args.equipeId)
    .eq('evento_id', args.eventoId)
    .maybeSingle();

  if (!equipe || !(equipe as EquipeRow).ativo) return null;

  const row = equipe as EquipeRow;
  const role = normalizeEventoRole(row.tipo);
  if (!role) return null;
  if (row.convite_expira_em && new Date(row.convite_expira_em) < new Date()) return null;

  return { role, equipe: row, source: 'equipe' };
}

export async function requireEventoPermission(
  request: NextRequest,
  eventoId: string,
  area: EventoArea,
): Promise<GuardAllowed | GuardDenied> {
  const supabaseAdmin = createServerClient();
  const { data: evento } = await supabaseAdmin
    .from('eventos')
    .select('id,departamento,status')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return { ok: false, response: NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 }) };
  }
  const user = await resolveAuthenticatedUser(request);
  const equipeId = await extractEquipeIdFromRequest(request);

  let resolved: { role: EventoRole; source: EventoGuardContext['source']; equipe?: EquipeRow } | null = null;

  // 1. Se há usuário autenticado no sistema (Admin Global ou Gestor), resolve o papel do usuário primeiro
  if (user) {
    const userResolved = await resolveUserRole({ supabaseAdmin, user, evento: evento as EventoRow });
    if (userResolved && canAccessEventoArea(userResolved.role, area)) {
      resolved = userResolved;
    }
  }

  // 2. Se não resolveu com permissão suficiente para a área, tenta via operador de equipe (header x-evento-equipe-id ou query)
  if (!resolved && equipeId) {
    const equipeResolved = await resolveEquipeRole({ supabaseAdmin, eventoId, equipeId });
    if (equipeResolved && canAccessEventoArea(equipeResolved.role, area)) {
      resolved = equipeResolved;
    }
  }

  // 3. Fallback: se ainda não resolveu com acesso permitido, obtém o papel real do usuário ou equipe para log e retorno coerentes
  if (!resolved) {
    if (user) {
      resolved = await resolveUserRole({ supabaseAdmin, user, evento: evento as EventoRow });
    } else if (equipeId) {
      resolved = await resolveEquipeRole({ supabaseAdmin, eventoId, equipeId });
    }
  }

  if (!resolved) {
    await logDeniedAccess({
      request,
      eventoId,
      area,
      role: null,
      user,
      equipeId,
      motivo: 'sem_vinculo_ou_sessao',
    });
    const rawSessao = request.nextUrl.searchParams.get('rawSessao') || undefined;
    return { ok: false, response: deniedResponse(area, null, { equipeId, userEmail: user?.email, url: request.url, method: request.method, rawSessao }) };
  }

  if (!canAccessEventoArea(resolved.role, area)) {
    const rawSessao = request.nextUrl.searchParams.get('rawSessao') || undefined;
    await logDeniedAccess({
      request,
      eventoId,
      area,
      role: resolved.role,
      user,
      equipeId,
      motivo: 'area_nao_permitida',
    });
    return { ok: false, response: deniedResponse(area, resolved.role, { equipeId, userEmail: user?.email, url: request.url, method: request.method, resolvedSource: resolved.source, rawSessao }) };
  }

  await logGrantedAccess({ request, eventoId, area, role: resolved.role, user, equipeId });

  // Resolve objeto da equipe se disponível para o contexto operacional
  let equipeObj: EquipeRow | null = resolved.equipe ?? null;
  if (!equipeObj && equipeId) {
    const eq = await resolveEquipeRole({ supabaseAdmin, eventoId, equipeId });
    if (eq?.equipe) equipeObj = eq.equipe;
  }

  return {
    ok: true,
    ctx: {
      user,
      equipe: equipeObj,
      evento: evento as EventoRow,
      role: resolved.role,
      permissao: resolved.role,
      source: resolved.source,
      perms: resolveEventoPermissoes({ perm: resolved.role, isGlobal: false, isDeptAdmin: false }),
      supabaseAdmin,
    },
  };
}

export async function requireEventoAccess(
  _request: NextRequest,
  eventoId: string,
): Promise<GuardAllowed | GuardDenied> {
  const supabaseAdmin = createServerClient();
  const user = await resolveAuthenticatedUser(_request);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const { data: evento } = await supabaseAdmin
    .from('eventos')
    .select('id,departamento,status')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return { ok: false, response: NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 }) };
  }

  const resolved = await resolveUserRole({ supabaseAdmin, user, evento: evento as EventoRow });
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return {
    ok: true,
    ctx: {
      user,
      equipe: null,
      evento: evento as EventoRow,
      role: resolved.role,
      permissao: resolved.role,
      source: resolved.source,
      perms: resolveEventoPermissoes({ perm: resolved.role, isGlobal: false, isDeptAdmin: false }),
      supabaseAdmin,
    },
  };
}