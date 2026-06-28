import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const { searchParams } = new URL(request.url);
  const supabase = createServerClient();

  // 1. Identificar operador/equipe
  let equipeId = searchParams.get('equipeId') || searchParams.get('equipe_id') || request.headers.get('x-evento-equipe-id');

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
  let { data: sessao, error: sessaoErr } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .eq('evento_id', eventoId)
    .eq('operador_id', equipeId)
    .eq('status', 'aberto')
    .maybeSingle();

  if (sessaoErr) {
    return NextResponse.json({ error: 'Erro ao buscar sessão de caixa.' }, { status: 500 });
  }

  // Se houver uma sessão aberta, validar se é de hoje para evitar acúmulos de dias anteriores
  if (sessao) {
    const dataAbertura = new Date(sessao.data_abertura);
    const hoje = new Date();
    const mesmoDia = 
      dataAbertura.getDate() === hoje.getDate() &&
      dataAbertura.getMonth() === hoje.getMonth() &&
      dataAbertura.getFullYear() === hoje.getFullYear();

    if (!mesmoDia) {
      console.log(`[CAIXA_RESUMO] Fechando sessão antiga de ${sessao.operador_nome} (aberta em ${sessao.data_abertura})`);
      
      const hojeInicio = new Date();
      hojeInicio.setHours(0, 0, 0, 0);
      const hojeInicioISO = hojeInicio.toISOString();

      // 1. Calcular o saldo esperado de ontem (inscrições rápidas/balcão antes de hoje)
      const { data: inscsOntem } = await supabase
        .from('evento_inscricoes')
        .select('valor_pago, status_pagamento, forma_pagamento')
        .eq('caixa_sessao_id', sessao.id)
        .eq('evento_id', eventoId)
        .lt('created_at', hojeInicioISO);

      let dinheiroOntem = 0;
      (inscsOntem || []).forEach((ins: any) => {
        if (ins.status_pagamento === 'pago' && ins.forma_pagamento === 'dinheiro') {
          dinheiroOntem += Number(ins.valor_pago || 0);
        }
      });

      // 2. Sangrias de ontem
      const { data: sangsOntem } = await supabase
        .from('evento_caixa_sangrias')
        .select('valor')
        .eq('caixa_sessao_id', sessao.id)
        .eq('status', 'registrada');

      let totalSangsOntem = 0;
      (sangsOntem || []).forEach((sang: any) => {
        totalSangsOntem += Number(sang.valor || 0);
      });

      const saldoEsperadoOntem = Math.max(0, dinheiroOntem - totalSangsOntem);

      // 3. Fechar caixa de ontem
      await supabase
        .from('evento_caixa_sessoes')
        .update({
          status: 'fechado',
          data_fechamento: sessao.data_abertura,
          saldo_dinheiro_esperado: saldoEsperadoOntem,
          saldo_dinheiro_informado: saldoEsperadoOntem,
          divergencia_dinheiro: 0,
          observacoes: 'Fechado automaticamente pelo sistema de renovação diária de caixas.'
        })
        .eq('id', sessao.id);

      // 4. Verificar se existem inscrições de hoje já gravadas com a sessão de ontem
      const { data: inscsHoje } = await supabase
        .from('evento_inscricoes')
        .select('id')
        .eq('caixa_sessao_id', sessao.id)
        .eq('evento_id', eventoId)
        .gte('created_at', hojeInicioISO);

      if (inscsHoje && inscsHoje.length > 0) {
        // Criar uma nova sessão de caixa limpa para hoje
        const { data: novaSessao } = await supabase
          .from('evento_caixa_sessoes')
          .insert({
            evento_id: eventoId,
            operador_id: equipeId,
            operador_nome: sessao.operador_nome,
            status: 'aberto',
            data_abertura: new Date().toISOString()
          })
          .select('*')
          .single();

        if (novaSessao) {
          // Migrar inscrições de hoje para a nova sessão
          const inscIds = inscsHoje.map((i: any) => i.id);
          await supabase
            .from('evento_inscricoes')
            .update({ caixa_sessao_id: novaSessao.id })
            .in('id', inscIds);

          sessao = novaSessao;
        } else {
          sessao = null;
        }
      } else {
        sessao = null;
      }
    }
  }

  if (!sessao) {
    return NextResponse.json({ ok: false, sessao: null, error: 'Nenhuma sessão de caixa aberta encontrada.' });
  }

  // 3. Buscar inscrições realizadas nesta sessão de caixa
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, valor_pago, status_pagamento, forma_pagamento, created_at')
    .eq('caixa_sessao_id', sessao.id)
    .eq('evento_id', eventoId)
    .eq('origem', 'balcao');

  const inscList = inscricoes || [];

  // 4. Buscar complementos de pagamento relacionados a inscrições desta sessão de caixa
  const { data: ordens } = await supabase
    .from('evento_ordens_pagamento')
    .select(`
      id,
      valor,
      status,
      paid_at,
      created_at,
      metadata,
      evento_inscricoes!inner (
        id,
        nome_inscrito,
        caixa_sessao_id
      )
    `)
    .eq('evento_id', eventoId)
    .eq('tipo_ordem', 'complemento')
    .eq('status', 'pago')
    .eq('evento_inscricoes.caixa_sessao_id', sessao.id);

  const ordensList = ordens || [];

  // 5. Buscar sangrias desta sessão de caixa
  const { data: sangrias } = await supabase
    .from('evento_caixa_sangrias')
    .select('*')
    .eq('caixa_sessao_id', sessao.id)
    .eq('status', 'registrada');

  const sangList = sangrias || [];

  // 6. Realizar os cálculos em runtime
  let dinheiroRecebido = 0;
  let pixRecebido = 0;
  let cartaoRecebido = 0;
  let cortesiasQtd = 0;
  let cortesiasValor = 0;

  // Processar inscrições
  inscList.forEach((ins: any) => {
    const forma = String(ins.forma_pagamento || '').toLowerCase();
    const status = String(ins.status_pagamento || '').toLowerCase();
    const valor = Number(ins.valor_pago || 0);

    if (status === 'isento') {
      cortesiasQtd += 1;
      cortesiasValor += valor;
    } else {
      if (forma === 'dinheiro') {
        dinheiroRecebido += valor;
      } else if (forma === 'pix') {
        pixRecebido += valor;
      } else if (forma === 'cartao' || forma === 'credito' || forma === 'debito') {
        cartaoRecebido += valor;
      }
    }
  });

  // Processar complementos
  let complementosQtd = 0;
  let complementosValor = 0;

  ordensList.forEach((ord: any) => {
    const valor = Number(ord.valor || 0);
    complementosQtd += 1;
    complementosValor += valor;

    // Identificar a forma de pagamento do complemento pelo metadata ou default para pix/cartão
    const forma = String(ord.metadata?.forma_pagamento || 'pix').toLowerCase();
    if (forma === 'dinheiro') {
      dinheiroRecebido += valor;
    } else if (forma === 'pix') {
      pixRecebido += valor;
    } else {
      cartaoRecebido += valor;
    }
  });

  // Processar sangrias
  let totalSangrias = 0;
  sangList.forEach((sang: any) => {
    totalSangrias += Number(sang.valor || 0);
  });

  const totalRecebido = dinheiroRecebido + pixRecebido + cartaoRecebido + cortesiasValor + complementosValor;
  const saldoEsperadoDinheiro = Math.max(0, dinheiroRecebido - totalSangrias);

  // 7. Montar a timeline cronológica consolidada
  const timeline: any[] = [];

  inscList.forEach((ins: any) => {
    timeline.push({
      id: ins.id,
      tipo: 'Inscrição',
      nome: ins.nome_inscrito,
      forma: ins.forma_pagamento || 'Outro',
      valor: Number(ins.valor_pago || 0),
      status: ins.status_pagamento,
      data: ins.created_at,
    });
  });

  ordensList.forEach((ord: any) => {
    timeline.push({
      id: ord.id,
      tipo: 'Complemento',
      nome: (ord.evento_inscricoes as any)?.nome_inscrito || 'Inscrito',
      forma: ord.metadata?.forma_pagamento || 'PIX',
      valor: Number(ord.valor || 0),
      status: ord.status,
      data: ord.paid_at || ord.created_at,
    });
  });

  sangList.forEach((sang: any) => {
    timeline.push({
      id: sang.id,
      tipo: 'Sangria',
      nome: sang.retirado_por || 'Supervisor',
      forma: 'Dinheiro',
      valor: -Number(sang.valor || 0),
      status: sang.status,
      data: sang.created_at,
    });
  });

  // Ordenar timeline por data (mais recente primeiro)
  timeline.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return NextResponse.json({
    ok: true,
    sessao,
    resumo: {
      totalRecebido,
      dinheiroRecebido,
      pixRecebido,
      cartaoRecebido,
      cortesiasQtd,
      cortesiasValor,
      complementosQtd,
      complementosValor,
      totalSangrias,
      saldoEsperadoDinheiro,
    },
    timeline,
  });
}
