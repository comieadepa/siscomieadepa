/**
 * PATCH /api/portal-ministro/notificacoes/[id]/ler
 * Marca uma notificação específica do ministro autenticado como lida.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'ID da notificação é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Verifica se a notificação existe e pertence ao ministro autenticado
  const { data: notif, error: fetchErr } = await supabase
    .from('ministro_portal_notificacoes')
    .select('id, lida')
    .eq('id', id)
    .eq('ministro_id', session.ministroId)
    .maybeSingle();

  if (fetchErr || !notif) {
    return NextResponse.json({ error: 'Notificação não encontrada.' }, { status: 404 });
  }

  // Se já estiver lida, retorna sucesso imediatamente (idempotente)
  if (notif.lida) {
    return NextResponse.json({ ok: true, id, status: 'ja_lida' });
  }

  const { error: updErr } = await supabase
    .from('ministro_portal_notificacoes')
    .update({
      lida: true,
      lida_em: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('ministro_id', session.ministroId);

  if (updErr) {
    console.error('[notificacoes/ler] Erro ao marcar como lida:', updErr.message);
    return NextResponse.json({ error: 'Erro ao atualizar notificação.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, status: 'lida' });
}
