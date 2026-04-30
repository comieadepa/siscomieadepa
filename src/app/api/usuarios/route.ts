import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireFlowAuth, hasRole } from '@/lib/flows/flow-auth';

type UsuarioResponse = {
  id: string;
  nome: string;
  email: string;
  email_confirmed: boolean;
  nivel: 'administrador' | 'financeiro' | 'operador' | 'supervisor';
  congregacao?: string;
  congregacao_id?: string | null;
  status: 'ativo' | 'inativo';
};

type UsuarioCreateBody = {
  nome: string;
  email: string;
  senha: string;
  nivel: UsuarioResponse['nivel'];
  congregacao_id?: string | null;
};

type UsuarioUpdateBody = {
  user_id: string;
  nome: string;
  email: string;
  nivel: UsuarioResponse['nivel'];
  congregacao_id?: string | null;
  status?: UsuarioResponse['status'];
  senha?: string | null;
};

function mapNivel(role: string | null | undefined): UsuarioResponse['nivel'] {
  const base = String(role || '').toLowerCase();
  if (['admin'].includes(base)) return 'administrador';
  if (['financeiro', 'financial'].includes(base)) return 'financeiro';
  if (['supervisor', 'manager'].includes(base)) return 'supervisor';
  return 'operador';
}

function resolveStatus(user: any): 'ativo' | 'inativo' {
  const bannedUntil = user?.banned_until ? new Date(user.banned_until) : null;
  if (bannedUntil && bannedUntil.getTime() > Date.now()) return 'inativo';
  return 'ativo';
}

function resolveNome(user: any): string {
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || meta.nome || user?.email || 'Sem nome');
}

function resolveEmailConfirmed(user: any): boolean {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

// Mapeia nivel → role para a tabela public.users
function mapRoleFromNivel(nivel: UsuarioResponse['nivel']): string {
  switch (nivel) {
    case 'administrador': return 'admin';
    case 'financeiro': return 'financeiro';
    case 'supervisor': return 'manager';
    default: return 'operator';
  }
}

export async function GET(request: NextRequest) {
  try {
    const { roles } = await requireFlowAuth(request);
    if (!hasRole(roles, ['ADMINISTRADOR'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createServerClient();

    // Buscar todos os usuários de public.users
    const { data: usersRows, error: usersError } = await admin
      .from('users')
      .select('id, email, name, role, is_active, last_activity');

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 400 });
    }

    const rows = usersRows || [];

    // Buscar dados de auth para saber email_confirmed e banned_until
    const authResults = await Promise.all(
      rows.map(async (row: any) => {
        const { data, error } = await admin.auth.admin.getUserById(row.id);
        return { row, user: data?.user || null, error };
      })
    );

    // Buscar congregação de cada usuário (se tiver congregacao_id em algum lugar futuro)
    const congregacaoIds: string[] = [];
    const congregacaoMap = new Map<string, string>();
    if (congregacaoIds.length > 0) {
      const { data: congregacoes } = await admin
        .from('congregacoes')
        .select('id, nome')
        .in('id', congregacaoIds);
      (congregacoes || []).forEach((c: any) => congregacaoMap.set(String(c.id), String(c.nome || '')));
    }

    const usuarios: UsuarioResponse[] = authResults.map(({ row, user }) => ({
      id: String(row.id),
      nome: resolveNome(user) || String(row.name || row.email || ''),
      email: String(user?.email || row.email || ''),
      email_confirmed: resolveEmailConfirmed(user),
      nivel: mapNivel(row.role),
      congregacao: undefined,
      congregacao_id: null,
      status: row.is_active === false ? 'inativo' : resolveStatus(user),
    }));

    return NextResponse.json({ data: usuarios });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno do servidor';
    if (message === 'TRIAL_EXPIRED') return NextResponse.json({ error: 'Expirado' }, { status: 403 });
    const status = message === 'UNAUTHORIZED' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { roles } = await requireFlowAuth(request);
    if (!hasRole(roles, ['ADMINISTRADOR'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as Partial<UsuarioCreateBody>;
    const nome = String(body?.nome || '').trim();
    const email = String(body?.email || '').trim();
    const senha = String(body?.senha || '').trim();
    const nivel = body?.nivel as UsuarioResponse['nivel'];
    const congregacaoId = body?.congregacao_id ? String(body.congregacao_id) : null;

    if (!nome || !email || !senha || !nivel) {
      return NextResponse.json({ error: 'nome, email, senha e nivel sao obrigatorios' }, { status: 400 });
    }

    if (senha.length < 6) {
      return NextResponse.json({ error: 'Senha muito curta' }, { status: 400 });
    }

    const admin = createServerClient();

    // Verificar limite de usuários (máximo 10 no single-tenant)
    const { count: totalUsuarios } = await admin
      .from('users')
      .select('*', { count: 'exact', head: true });

    if ((totalUsuarios ?? 0) >= 10) {
      return NextResponse.json(
        { error: 'Limite de usuários atingido (máximo: 10).' },
        { status: 403 }
      );
    }

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: nome },
    });

    if (authError || !authUser?.user) {
      return NextResponse.json({ error: authError?.message || 'Erro ao criar usuario' }, { status: 400 });
    }

    // Inserir em public.users
    const { error: insertError } = await admin
      .from('users')
      .insert({
        id: authUser.user.id,
        email,
        name: nome,
        role: mapRoleFromNivel(nivel),
        is_active: true,
      } as any);

    if (insertError) {
      await admin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    void congregacaoId; // reservado para uso futuro

    return NextResponse.json({ success: true, id: authUser.user.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno do servidor';
    if (message === 'TRIAL_EXPIRED') return NextResponse.json({ error: 'Expirado' }, { status: 403 });
    const status = message === 'UNAUTHORIZED' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function resolveBannedUntil(status: UsuarioResponse['status'] | undefined) {
  if (!status) return undefined;
  if (status === 'ativo') return null;
  const future = new Date();
  future.setFullYear(future.getFullYear() + 100);
  return future.toISOString();
}

export async function PUT(request: NextRequest) {
  try {
    const { roles } = await requireFlowAuth(request);
    if (!hasRole(roles, ['ADMINISTRADOR'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as Partial<UsuarioUpdateBody>;
    const userId = String(body?.user_id || '').trim();
    const nome = String(body?.nome || '').trim();
    const email = String(body?.email || '').trim();
    const nivel = body?.nivel as UsuarioResponse['nivel'];
    const congregacaoId = body?.congregacao_id ? String(body.congregacao_id) : null;
    const status = body?.status as UsuarioResponse['status'] | undefined;
    const senha = body?.senha ? String(body.senha).trim() : '';

    if (!userId || !nome || !email || !nivel) {
      return NextResponse.json({ error: 'user_id, nome, email e nivel sao obrigatorios' }, { status: 400 });
    }

    if (senha && senha.length < 6) {
      return NextResponse.json({ error: 'Senha muito curta' }, { status: 400 });
    }

    const admin = createServerClient();
    const banned_until = resolveBannedUntil(status);

    const { data: existingUser, error: existingUserError } = await admin.auth.admin.getUserById(userId);
    if (existingUserError) {
      return NextResponse.json({ error: existingUserError.message }, { status: 400 });
    }

    const confirmed = resolveEmailConfirmed(existingUser?.user);
    const currentEmail = String(existingUser?.user?.email || '').trim();
    if (!confirmed && currentEmail && email !== currentEmail) {
      return NextResponse.json({ error: 'Email nao confirmado. Nao e possivel alterar o email.' }, { status: 400 });
    }

    const updatePayload: Record<string, any> = {
      email,
      user_metadata: { full_name: nome },
      email_confirm: true,
    };

    if (senha) updatePayload.password = senha;
    if (banned_until !== undefined) updatePayload.banned_until = banned_until;

    const { error: authError } = await admin.auth.admin.updateUserById(userId, updatePayload);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // Atualizar public.users
    const { error: updateError } = await admin
      .from('users')
      .update({
        name: nome,
        email,
        role: mapRoleFromNivel(nivel),
        is_active: status ? status === 'ativo' : undefined,
      })
      .eq('id', userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    void congregacaoId; // reservado para uso futuro

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno do servidor';
    if (message === 'TRIAL_EXPIRED') return NextResponse.json({ error: 'Expirado' }, { status: 403 });
    const status = message === 'UNAUTHORIZED' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { roles, userId: currentUserId } = await requireFlowAuth(request);
    if (!hasRole(roles, ['ADMINISTRADOR'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = String(request.nextUrl.searchParams.get('user_id') || '').trim();
    if (!userId) {
      return NextResponse.json({ error: 'user_id é obrigatório' }, { status: 400 });
    }

    if (userId === currentUserId) {
      return NextResponse.json({ error: 'Você não pode remover sua própria conta.' }, { status: 403 });
    }

    const admin = createServerClient();

    // Verificar se o usuário existe em public.users
    const { data: existing, error: checkError } = await admin
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (checkError || !existing) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Deletar de public.users (CASCADE para auth.users via FK)
    const { error: deleteError } = await admin
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    // Deletar de auth.users
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      return NextResponse.json({ error: deleteAuthError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno do servidor';
    if (message === 'TRIAL_EXPIRED') return NextResponse.json({ error: 'Expirado' }, { status: 403 });
    const status = message === 'UNAUTHORIZED' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}