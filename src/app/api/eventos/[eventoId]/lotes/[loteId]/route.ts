import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatarFormaPagamentoReal(formaRaw?: string | null): string {
  if (!formaRaw) return 'Não informada';
  const f = formaRaw.trim().toLowerCase();
  if (f === 'pix') return 'PIX';
  if (f === 'cartao' || f === 'credito' || f === 'credit_card') return 'Cartão de Crédito';
  if (f === 'dinheiro') return 'Dinheiro';
  if (f === 'isento') return 'Isento';
  return formaRaw.toUpperCase();
}

/**
 * GET /api/eventos/[eventoId]/lotes/[loteId]
 * Consulta detalhada e exclusivamente consultiva de um pagamento em lote.
 * Retorna dados reais do lote, responsável, situação, referência ASAAS e lista de participantes com valores individuais.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; loteId: string }> }
) {
  const { eventoId, loteId } = await params;

  // 1. Autorização: Usuário autenticado com permissão na área de inscrições do evento
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // 2. Busca os dados reais do lote vinculado ao evento (isolamento estrito por evento)
  const { data: lote, error: errLote } = await supabase
    .from('evento_lotes_inscricao')
    .select(`
      id,
      evento_id,
      codigo,
      responsavel_nome,
      responsavel_email,
      responsavel_whatsapp,
      valor_total,
      status_pagamento,
      asaas_payment_id,
      cupom_codigo,
      desconto_valor,
      comprovante_url,
      created_at,
      invoice_url,
      asaas_due_date
    `)
    .eq('id', loteId)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (errLote) {
    console.error('[API LOTE DETALHES] Erro ao buscar lote:', errLote);
    return NextResponse.json({ error: 'Erro ao consultar lote.' }, { status: 500 });
  }

  if (!lote) {
    return NextResponse.json({ error: 'Lote não encontrado para este evento.' }, { status: 404 });
  }

  // 3. Busca todos os participantes vinculados exclusivamente pelo lote_id no banco
  const { data: inscricoes, error: errInsc } = await supabase
    .from('evento_inscricoes')
    .select(`
      id,
      nome_inscrito,
      cpf,
      tipo_inscricao,
      status_pagamento,
      forma_pagamento,
      valor_final,
      valor_pago,
      valor_original,
      created_at,
      updated_at
    `)
    .eq('evento_id', eventoId)
    .eq('lote_id', loteId)
    .order('created_at', { ascending: true });

  if (errInsc) {
    console.error('[API LOTE DETALHES] Erro ao buscar inscricoes do lote:', errInsc);
    return NextResponse.json({ error: 'Erro ao consultar participantes do lote.' }, { status: 500 });
  }

  const participantes = (inscricoes || []).map((ins: any) => {
    const valorIndividual = ins.valor_final !== null && ins.valor_final !== undefined
      ? Number(ins.valor_final)
      : (ins.valor_original !== null && ins.valor_original !== undefined
        ? Number(ins.valor_original)
        : (ins.valor_pago !== null && ins.valor_pago !== undefined ? Number(ins.valor_pago) : 0));

    return {
      id: ins.id,
      nome_inscrito: ins.nome_inscrito,
      cpf: ins.cpf,
      tipo_inscricao: ins.tipo_inscricao,
      status_pagamento: ins.status_pagamento,
      forma_pagamento: formatarFormaPagamentoReal(ins.forma_pagamento),
      valor_individual: valorIndividual,
      updated_at: ins.updated_at,
    };
  });

  // 4. Cálculos e validação de consistência financeira
  const valorTotalCobranca = Number(lote.valor_total || 0);
  const totalSomaInscricoes = participantes.reduce((acc: number, p: any) => acc + p.valor_individual, 0);
  
  // Se o lote estiver pago, o valor efetivamente pago é o valor_total da cobrança confirmada
  const isPago = lote.status_pagamento === 'pago';
  const valorEfetivamentePago = isPago ? valorTotalCobranca : 0;

  // Data de confirmação efetiva do pagamento: updated_at dos participantes confirmados
  const dataConfirmacao = isPago && participantes.length > 0
    ? (participantes[0].updated_at || null)
    : null;

  // Forma de pagamento real detectada dos participantes
  const formaPagamentoReal = participantes.find((p: any) => p.forma_pagamento && p.forma_pagamento !== 'Não informada')?.forma_pagamento || (lote.asaas_payment_id ? 'ASAAS / PIX' : 'Não informada');

  const diferenca = Math.abs(totalSomaInscricoes - valorTotalCobranca);
  const temDivergencia = diferenca > 0.01;

  return NextResponse.json({
    lote: {
      id: lote.id,
      codigo: lote.codigo || '—',
      responsavel_nome: lote.responsavel_nome || 'Não informado',
      responsavel_email: lote.responsavel_email || null,
      responsavel_whatsapp: lote.responsavel_whatsapp || null,
      status_pagamento: lote.status_pagamento || 'pendente',
      valor_cobranca: valorTotalCobranca,
      valor_efetivamente_pago: valorEfetivamentePago,
      asaas_payment_id: lote.asaas_payment_id || null,
      data_criacao: lote.created_at,
      data_confirmacao: dataConfirmacao,
      data_vencimento: lote.asaas_due_date || null,
      invoice_url: lote.invoice_url || null,
      comprovante_url: lote.comprovante_url || null,
      forma_pagamento: formaPagamentoReal,
    },
    resumo_financeiro: {
      quantidade_participantes: participantes.length,
      total_soma_inscricoes: totalSomaInscricoes,
      valor_cobranca: valorTotalCobranca,
      valor_efetivamente_pago: valorEfetivamentePago,
      tem_divergencia: temDivergencia,
      diferenca_valor: temDivergencia ? diferenca : 0,
    },
    participantes,
  });
}
