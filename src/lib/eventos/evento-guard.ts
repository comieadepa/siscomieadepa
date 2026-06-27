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
  const byQuery = request.nextUrl.searchParams.get('equipe_id') || request.nextUrl.searchParams.get('equipeId');
  if (byQuery) return byQuery.trim() || null;

  const byHeader = request.headers.get('x-evento-equipe-id');
  if (byHeader) return byHeader.trim() || null;

  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;

  try {
    const body = await request.clone().json() as { equipe_id?: string; equipeId?: string };
    const value = body.equipe_id || body.equipeId;
    return value ? value.trim() || null : null;
  } catch {
    return null;
  }
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

async function resolveAuthenticatedUser(): Promise<User | null> {
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  return user ?? null;
}

async function resolveUserRole(args: {
  supabaseAdmin: ReturnType<typeof createServerClient>;
  user: User;
  evento: EventoRow;
}): Promise<{ role: EventoRole; source: EventoGuardContext['source'] } | null> {
  const meta = args.user.user_metadata || {};
  const rawNivel = (meta.nivel || meta.role || args.user.app_metadata?.role) as string | undefined;
  const nivel = normalizeRole(rawNivel ?? '');
  const departamento = (meta.subcategoria as string | undefined) ?? '';
  const isGlobal = nivel === 'super' || nivel === 'administrador';

  if (isGlobal) {
    return { role: 'admin_evento', source: 'global' };
  }

  if (nivel === 'inscricao') {
    // 1. Verificar nova tabela usuario_eventos_permitidos
    const { data: permitido } = await args.supabaseAdmin
      .from('usuario_eventos_permitidos')
      .select('id')
      .eq('usuario_id', args.user.id)
      .eq('evento_id', args.evento.id)
      .maybeSingle();

    if (permitido) {
      return { role: 'admin_evento', source: 'usuario_evento' };
    }

    if (departamento === 'TODOS') {
      return { role: 'admin_evento', source: 'departamento' };
    }

    // 2. Fallback temporário por subcategoria (somente se não houver registros na nova tabela para este usuário)
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

    return null;
  }

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
    .select('id,evento_id,tipo,ativo,convite_expira_em')
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
  const user = await resolveAuthenticatedUser();
  const equipeId = await extractEquipeIdFromRequest(request);

  let resolved: { role: EventoRole; source: EventoGuardContext['source']; equipe?: EquipeRow } | null = null;

  if (equipeId) {
    resolved = await resolveEquipeRole({ supabaseAdmin, eventoId, equipeId });
  }
  if (!resolved && user) {
    resolved = await resolveUserRole({ supabaseAdmin, user, evento: evento as EventoRow });
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

  return {
    ok: true,
    ctx: {
      user,
      equipe: resolved.equipe ?? null,
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
  const user = await resolveAuthenticatedUser();
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