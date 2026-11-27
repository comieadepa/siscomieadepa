import type { User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import { normalizeRole } from '@/lib/auth/roles';

export interface OperadorIdentificado {
  equipeId: string;
  nome: string;
  email: string | null;
  isAdmin: boolean;
}

/**
 * Identifica com robustez o operador da requisição de caixa/balcão,
 * aceitando tanto operadores normais de evento_equipe quanto gestores e
 * administradores globais (SUPER / ADMINISTRADOR).
 */
export async function identificarOperadorCaixa(
  request: NextRequest,
  eventoId: string
): Promise<OperadorIdentificado | null> {
  const adminSupabase = createServerClient();
  const searchParams = request.nextUrl.searchParams;

  // 1. Tentar ler equipeId passado diretamente nos cabeçalhos ou query params
  let equipeId =
    searchParams.get('equipeId') ||
    searchParams.get('equipe_id') ||
    request.headers.get('x-evento-equipe-id');

  if (equipeId) {
    const { data: eq } = await adminSupabase
      .from('evento_equipe')
      .select('id, nome, email, ativo')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .maybeSingle();

    if (eq && eq.ativo !== false) {
      return {
        equipeId: eq.id,
        nome: eq.nome || 'Operador Balcão',
        email: eq.email || null,
        isAdmin: false,
      };
    }
  }

  // 2. Tentar identificar o usuário logado via sessão/cookies ou Bearer token
  let user: User | null = null;
  try {
    const userClient = await createServerClientFromCookies();
    const { data } = await userClient.auth.getUser();
    if (data?.user) user = data.user;
  } catch {}

  if (!user) {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const { data } = await adminSupabase.auth.getUser(token);
        if (data?.user) user = data.user;
      } catch {}
    }
  }

  if (!user || !user.email) {
    return null;
  }

  const userEmail = user.email.trim().toLowerCase();

  // 3. Verificar se o e-mail do usuário logado já está registrado na equipe do evento
  const { data: eqUser } = await adminSupabase
    .from('evento_equipe')
    .select('id, nome, email, ativo')
    .eq('evento_id', eventoId)
    .ilike('email', userEmail)
    .maybeSingle();

  if (eqUser && eqUser.ativo !== false) {
    return {
      equipeId: eqUser.id,
      nome: eqUser.nome || user.user_metadata?.full_name || user.user_metadata?.name || userEmail,
      email: eqUser.email || userEmail,
      isAdmin: false,
    };
  }

  // 4. Se não estiver na equipe, verificar se é um usuário com permissão administrativa (SUPER, ADMINISTRADOR ou GESTOR DO EVENTO)
  const meta = user.user_metadata || {};
  const rawRole = (meta.nivel || meta.role || user.app_metadata?.role) as string | undefined;
  let role = normalizeRole(rawRole ?? '');

  if (!role) {
    const { data: dbUser } = await adminSupabase
      .from('users')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (dbUser?.is_active !== false && dbUser?.role) {
      role = normalizeRole(dbUser.role);
    }
  }

  // Verificar se possui vínculo em usuario_eventos_permitidos ou subcategoria do evento
  let isGestorEvento = false;
  if (!role || (role !== 'super' && role !== 'administrador')) {
    const { data: permitido } = await adminSupabase
      .from('usuario_eventos_permitidos')
      .select('id')
      .eq('usuario_id', user.id)
      .eq('evento_id', eventoId)
      .maybeSingle();

    if (permitido) isGestorEvento = true;

    if (!isGestorEvento && meta.subcategoria === eventoId) {
      isGestorEvento = true;
    }
  }

  const isSuperOrAdmin = role === 'super' || role === 'administrador' || isGestorEvento;
  if (!isSuperOrAdmin) {
    return null;
  }

  // 5. Para acesso administrativo legítimo, assegurar/obter o registro de equipe do gestor
  const opNome =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    (role === 'super' ? 'Administrador Geral' : 'Gestor Administrativo');

  const { data: novaEquipe, error: insErr } = await adminSupabase
    .from('evento_equipe')
    .insert({
      evento_id: eventoId,
      email: userEmail,
      nome: opNome,
      tipo: 'operador',
      ativo: true,
      criado_por: user.id,
    })
    .select('id, nome, email')
    .single();

  if (novaEquipe && !insErr) {
    return {
      equipeId: novaEquipe.id,
      nome: novaEquipe.nome || opNome,
      email: novaEquipe.email || userEmail,
      isAdmin: true,
    };
  }

  // Fallback se colidir em concorrência
  const { data: eqRecup } = await adminSupabase
    .from('evento_equipe')
    .select('id, nome, email')
    .eq('evento_id', eventoId)
    .ilike('email', userEmail)
    .maybeSingle();

  if (eqRecup) {
    return {
      equipeId: eqRecup.id,
      nome: eqRecup.nome || opNome,
      email: eqRecup.email || userEmail,
      isAdmin: true,
    };
  }

  return null;
}
