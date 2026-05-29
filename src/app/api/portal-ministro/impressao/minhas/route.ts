/**
 * GET /api/portal-ministro/impressao/minhas
 * Retorna as solicitações de impressão do ministro autenticado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

const STATUS_LABEL: Record<string, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  pago_pendente_impressao: 'Pago — aguardando impressão',
  impresso: 'Impresso',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .select('id, status, valor_centavos, solicitado_em, pago_em, impresso_em, entregue_em')
    .eq('ministro_id', session.ministroId)
    .order('solicitado_em', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ data: [] });
  }

  const itens = (data || []).map((row: any) => ({
    id: row.id,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    valor: row.valor_centavos / 100,
    solicitadoEm: row.solicitado_em,
    pagoEm: row.pago_em,
    impresso_em: row.impresso_em,
    entregueEm: row.entregue_em,
  }));

  return NextResponse.json({ data: itens });
}
