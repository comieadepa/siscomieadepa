import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import { resolveEventoPermissoes, type PermissaoEvento, type EventoPermissoes } from '@/lib/evento-permissions';

type EventoRow = {
  id: string;
  departamento: string | null;
  status?: string | null;
};

export type EventoGuardContext = {
  user: NonNullable<Awaited<ReturnType<ReturnType<typeof createServerClient>['auth']['getUser']>>['data']['user']>;
  evento: EventoRow;
  permissao: PermissaoEvento;
  perms: EventoPermissoes;
  supabaseAdmin: ReturnType<typeof createServerClient>;
};

export async function requireEventoAccess(
  _request: NextRequest,
  eventoId: string
): Promise<{ ok: true; ctx: EventoGuardContext } | { ok: false; response: NextResponse }> {
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const nivel = (user.user_metadata?.nivel as string | undefined) ?? '';
  const departamento = (user.user_metadata?.subcategoria as string | undefined) ?? '';
  const isGlobal = nivel === 'super' || nivel === 'admin';
  const isDeptAdmin = nivel === 'inscricao' && !!departamento;

  const supabaseAdmin = createServerClient();

  const { data: evento } = await supabaseAdmin
    .from('eventos')
    .select('id,departamento,status')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return { ok: false, response: NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 }) };
  }

  if (isDeptAdmin && evento.departamento !== departamento) {
    return { ok: false, response: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  let permissao: PermissaoEvento | null = null;

  if (isGlobal || isDeptAdmin) {
    permissao = 'admin_evento';
  } else {
    const { data: vinculo } = await supabaseAdmin
      .from('usuario_eventos')
      .select('permissao')
      .eq('user_id', user.id)
      .eq('evento_id', eventoId)
      .maybeSingle();
    permissao = (vinculo?.permissao as PermissaoEvento | undefined) ?? null;
  }

  if (!permissao) {
    return { ok: false, response: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  const perms = resolveEventoPermissoes({ perm: permissao, isGlobal, isDeptAdmin });

  return {
    ok: true,
    ctx: {
      user,
      evento: evento as EventoRow,
      permissao,
      perms,
      supabaseAdmin,
    },
  };
}
