/**
 * PATCH /api/portal-ministro/notificacoes/ler-todas
 * Marca todas as notificações não lidas do ministro autenticado como lidas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function PATCH(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  const agora = new Date().toISOString();

  const { error: updErr, count } = await supabase
    .from('ministro_portal_notificacoes')
    .update({
      lida: true,
      lida_em: agora,
    })
    .eq('ministro_id', session.ministroId)
    .eq('lida', false);

  if (updErr) {
    console.error('[notificacoes/ler-todas] Erro ao marcar todas como lidas:', updErr.message);
    return NextResponse.json({ error: 'Erro ao atualizar notificações.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    atualizadas: count ?? 0,
    timestamp: agora,
  });
}
