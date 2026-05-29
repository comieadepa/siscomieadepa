/**
 * GET /api/secretaria/impressoes-credenciais
 * Retorna fila de impressões de credenciais pendentes.
 * Requer autenticação Supabase (secretaria/super/administrador).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const ALLOWED_ROLES = ['super', 'administrador', 'cgadb'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status'); // opcional

  let query = supabase
    .from('credencial_impressoes_solicitacoes')
    .select('id, ministro_id, status, valor_centavos, asaas_payment_id, solicitado_em, pago_em, impresso_em, entregue_em, cancelado_em')
    .order('solicitado_em', { ascending: false })
    .limit(200);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  } else {
    // Por padrão retorna pendentes de impressão e já impressos recentes
    query = query.in('status', ['pago_pendente_impressao', 'impresso']);
  }

  const { data: solicitacoes, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!solicitacoes || solicitacoes.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // Busca dados dos ministros
  const ministroIds = [...new Set(solicitacoes.map((s: any) => s.ministro_id))];
  const { data: membros } = await supabase
    .from('members')
    .select('id, name, matricula, custom_fields, unique_id')
    .in('id', ministroIds);

  const membrosMap = new Map((membros || []).map((m: any) => [m.id, m]));

  const STATUS_LABEL: Record<string, string> = {
    aguardando_pagamento: 'Aguardando pagamento',
    pago_pendente_impressao: 'Pago — aguardando impressão',
    impresso: 'Impresso',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  };

  const items = solicitacoes.map((s: any) => {
    const m = membrosMap.get(s.ministro_id) as any;
    const cf = (m?.custom_fields && typeof m.custom_fields === 'object') ? m.custom_fields as Record<string, any> : {};
    return {
      id: s.id,
      ministroId: s.ministro_id,
      ministroNome: m?.name || '—',
      matricula: m?.matricula || cf.matricula || '—',
      campo: cf.campo || '—',
      supervisao: cf.supervisao || '—',
      uniqueId: m?.unique_id || null,
      status: s.status,
      statusLabel: STATUS_LABEL[s.status] || s.status,
      valor: s.valor_centavos / 100,
      asaasPaymentId: s.asaas_payment_id,
      solicitadoEm: s.solicitado_em,
      pagoEm: s.pago_em,
      impresso_em: s.impresso_em,
      entregueEm: s.entregue_em,
    };
  });

  return NextResponse.json({ data: items });
}
