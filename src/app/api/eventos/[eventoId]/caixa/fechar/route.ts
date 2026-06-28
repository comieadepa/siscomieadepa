import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const { saldo_dinheiro_informado, observacoes } = await request.json();

  if (saldo_dinheiro_informado === undefined || saldo_dinheiro_informado === null) {
    return NextResponse.json({ error: 'Saldo em dinheiro informado é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Identificar operador/equipe
  let equipeId = request.headers.get('x-evento-equipe-id');

  if (!equipeId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data: eq } = await supabase
        .from('evento_equipe')
        .select('id, nome')
        .eq('evento_id', eventoId)
        .eq('email', user.email)
        .eq('ativo', true)
        .maybeSingle();
      if (eq) {
        equipeId = eq.id;
      }
    }
  }

  if (!equipeId) {
    return NextResponse.json({ error: 'Operador não identificado.' }, { status: 403 });
  }

  // 2. Obter a sessão de caixa ativa
  const { data: sessao, error: sessaoErr } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .eq('evento_id', eventoId)
    .eq('operador_id', equipeId)
    .eq('status', 'aberto')
    .maybeSingle();

  if (sessaoErr || !sessao) {
    return NextResponse.json({ error: 'Nenhuma sessão de caixa aberta encontrada.' }, { status: 404 });
  }

  // 3. Buscar transações realizadas nesta sessão de caixa para consolidar o esperado
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('valor_pago, status_pagamento, forma_pagamento')
    .eq('caixa_sessao_id', sessao.id)
    .eq('evento_id', eventoId)
    .eq('origem', 'balcao');

  const { data: ordens } = await supabase
    .from('evento_ordens_pagamento')
    .select(`
      valor,
      metadata,
      evento_inscricoes!inner (
        caixa_sessao_id
      )
    `)
    .eq('evento_id', eventoId)
    .eq('tipo_ordem', 'complemento')
    .eq('status', 'pago')
    .eq('evento_inscricoes.caixa_sessao_id', sessao.id);

  const { data: sangrias } = await supabase
    .from('evento_caixa_sangrias')
    .select('valor')
    .eq('caixa_sessao_id', sessao.id)
    .eq('status', 'registrada');

  // Cálculos consolidados
  let dinheiroRecebido = 0;
  let complementosEmDinheiro = 0;

  if (inscricoes) {
    inscricoes.forEach((ins: any) => {
      const forma = String(ins.forma_pagamento || '').toLowerCase();
      const status = String(ins.status_pagamento || '').toLowerCase();
      if (status === 'pago' && forma === 'dinheiro') {
        dinheiroRecebido += Number(ins.valor_pago || 0);
      }
    });
  }

  if (ordens) {
    ordens.forEach((ord: any) => {
      const forma = String(ord.metadata?.forma_pagamento || 'pix').toLowerCase();
      if (forma === 'dinheiro') {
        complementosEmDinheiro += Number(ord.valor || 0);
      }
    });
  }

  const totalSangrias = (sangrias || []).reduce((s, o) => s + Number(o.valor || 0), 0);
  const saldoDinheiroEsperado = Math.max(0, (dinheiroRecebido + complementosEmDinheiro) - totalSangrias);

  const informadoVal = Number(saldo_dinheiro_informado);
  const divergencia = informadoVal - saldoDinheiroEsperado;

  // 4. Fechar a sessão no banco
  const { data: sessaoFechada, error: updateErr } = await supabase
    .from('evento_caixa_sessoes')
    .update({
      status: 'fechado',
      data_fechamento: new Date().toISOString(),
      saldo_dinheiro_esperado: saldoDinheiroEsperado,
      saldo_dinheiro_informado: informadoVal,
      divergencia_dinheiro: divergencia,
      observacoes: observacoes || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', sessao.id)
    .select('*')
    .single();

  if (updateErr) {
    return NextResponse.json({ error: 'Erro ao fechar sessão de caixa: ' + updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessao: sessaoFechada });
}
