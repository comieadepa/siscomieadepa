/**
 * GET /api/portal-ministro/notificacoes
 * Lista notificações do ministro autenticado e retorna a contagem de não lidas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '30', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 30 : limitParam), 100);

  // 1. Busca total de não lidas
  const { count: totalNaoLidas, error: countErr } = await supabase
    .from('ministro_portal_notificacoes')
    .select('*', { count: 'exact', head: true })
    .eq('ministro_id', session.ministroId)
    .eq('lida', false);

  if (countErr) {
    console.error('[notificacoes/GET] Erro ao contar não lidas:', countErr.message);
  }

  // 2. Busca lista de notificações
  const { data: notificacoes, error: listErr } = await supabase
    .from('ministro_portal_notificacoes')
    .select('id, tipo, titulo, mensagem, link_acao, lida, lida_em, canal, created_at')
    .eq('ministro_id', session.ministroId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (listErr) {
    console.error('[notificacoes/GET] Erro ao listar notificações:', listErr.message);
    return NextResponse.json({ error: 'Erro ao buscar notificações.' }, { status: 500 });
  }

  const itens = (notificacoes || []).map((n: any) => ({
    id: n.id,
    tipo: n.tipo,
    titulo: n.titulo,
    mensagem: n.mensagem,
    linkAcao: n.link_acao,
    lida: n.lida,
    lidaEm: n.lida_em,
    canal: n.canal,
    createdAt: n.created_at,
  }));

  return NextResponse.json({
    totalNaoLidas: totalNaoLidas || 0,
    notificacoes: itens,
  });
}
