/**
 * GET /api/v1/secretaria/aemadepa/pedidos
 * Retorna as solicitações de carteirinhas AEMADEPA com vínculo à associada e ao ministro.
 *
 * PATCH /api/v1/secretaria/aemadepa/pedidos
 * Atualiza status (em_impressao, impressa, entregue) com rastreabilidade de entrega.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');

  try {
    let query = supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select(`
        id,
        associada_id,
        ministro_id,
        valor,
        via,
        asaas_payment_id,
        status,
        solicitado_em,
        pago_em,
        impresso_em,
        entregue_em,
        entregue_para,
        observacoes,
        created_at
      `)
      .order('solicitado_em', { ascending: false })
      .limit(300);

    if (statusFilter && statusFilter !== 'todos') {
      const statuses = statusFilter.split(',');
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0]);
      } else {
        query = query.in('status', statuses);
      }
    }

    const { data: solicitacoes, error: solErr } = await query;
    if (solErr) {
      console.error('[SECRETARIA AEMADEPA PEDIDOS] Erro ao buscar pedidos:', solErr);
      return NextResponse.json({ error: solErr.message }, { status: 500 });
    }

    if (!solicitacoes || solicitacoes.length === 0) {
      return NextResponse.json({ pedidos: [], resumo: { total: 0, arrecadado: 0 } });
    }

    // Busca detalhes das associadas e ministros
    const assocIds = [...new Set(solicitacoes.map((s) => s.associada_id))];
    const minIds = [...new Set(solicitacoes.map((s) => s.ministro_id))];

    const [{ data: associadas }, { data: ministros }] = await Promise.all([
      supabase
        .from('aemadepa_associadas')
        .select('*')
        .in('id', assocIds),
      supabase
        .from('members')
        .select('id, name, matricula, custom_fields, unique_id')
        .in('id', minIds),
    ]);

    const assocMap = new Map((associadas || []).map((a) => [a.id, a]));
    const minMap = new Map((ministros || []).map((m) => [m.id, m]));

    const pedidosFormatados = solicitacoes.map((s) => {
      const assoc = assocMap.get(s.associada_id) as any;
      const min = minMap.get(s.ministro_id) as any;
      const cfMin = (min?.custom_fields && typeof min.custom_fields === 'object') ? min.custom_fields : {};

      return {
        id: s.id,
        associadaId: s.associada_id,
        ministroId: s.ministro_id,
        valor: Number(s.valor),
        via: s.via,
        status: s.status,
        asaasPaymentId: s.asaas_payment_id,
        solicitadoEm: s.solicitado_em,
        pagoEm: s.pago_em,
        impressoEm: s.impresso_em,
        entregueEm: s.entregue_em,
        entreguePara: s.entregue_para,
        observacoes: s.observacoes,
        // Dados da Associada para exibição e acoplamento direto ao CartaoAemadepa
        associada: {
          id: min?.id || s.ministro_id,
          uniqueId: min?.unique_id || assoc?.id,
          nomeEsposa: assoc?.nome || '—',
          cpfEsposa: assoc?.cpf || '—',
          rgEsposa: assoc?.rg || '',
          orgaoEmissorEsposa: assoc?.orgao_emissor || '',
          dataNascimentoEsposa: assoc?.data_nascimento || '',
          nacionalidadeEsposa: assoc?.nacionalidade || 'BRASILEIRA',
          naturalidadeEsposa: assoc?.naturalidade || '',
          nomePaiEsposa: assoc?.nome_pai || '',
          nomeMaeEsposa: assoc?.nome_mae || '',
          tituloEleitoralEsposa: assoc?.titulo_eleitoral || '',
          foneEsposa: assoc?.fone || '',
          emailEsposa: assoc?.email || '',
          tipoSanguineoEsposa: assoc?.tipo_sanguineo || '',
          fotoEsposaUrl: assoc?.foto_url || null,
          numeroAemadepa: assoc?.numero_aemadepa || cfMin.numero_aemadepa || '',
          ministroNome: min?.name || '—',
          ministroMatricula: min?.matricula || cfMin.matricula || '',
          ministroCpf: min?.cpf || '',
          cargoMinisterial: cfMin.cargo || cfMin.funcao || 'Pastor',
          campo: cfMin.campo || '',
          supervisao: cfMin.supervisao || '',
        },
      };
    });

    // Resumo financeiro de pagamentos confirmados
    const pagos = solicitacoes.filter((s) => ['pago', 'em_impressao', 'impressa', 'entregue'].includes(s.status));
    const totalArrecadado = pagos.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);

    return NextResponse.json({
      pedidos: pedidosFormatados,
      resumo: {
        totalPedidos: solicitacoes.length,
        pedidosPagos: pagos.length,
        totalArrecadado,
        aguardandoPagamento: solicitacoes.filter((s) => s.status === 'aguardando_pagamento').length,
        emFilaImpressao: solicitacoes.filter((s) => s.status === 'pago' || s.status === 'em_impressao').length,
        impressos: solicitacoes.filter((s) => s.status === 'impressa').length,
        entregues: solicitacoes.filter((s) => s.status === 'entregue').length,
      },
    });
  } catch (err: any) {
    console.error('[SECRETARIA AEMADEPA PEDIDOS] Erro geral:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.novoStatus) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const { id, novoStatus, entreguePara, observacoes } = body;
    const statusValidos = ['pago', 'em_impressao', 'impressa', 'entregue', 'cancelada'];
    if (!statusValidos.includes(novoStatus)) {
      return NextResponse.json({ error: 'Status informado inválido.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Busca pedido atual
    const { data: pedidoAtual, error: getErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (getErr || !pedidoAtual) {
      return NextResponse.json({ error: 'Pedido não localizado.' }, { status: 404 });
    }

    // Regra financeira: não permite cancelar se já tiver sido pago
    if (novoStatus === 'cancelada' && pedidoAtual.pago_em) {
      return NextResponse.json(
        { error: 'Não é permitido cancelar um pedido com pagamento confirmado.' },
        { status: 422 }
      );
    }

    const updatePayload: Record<string, any> = {
      status: novoStatus,
      updated_at: new Date().toISOString(),
    };

    if (novoStatus === 'em_impressao' && !pedidoAtual.impresso_em) {
      // transição para fila
    } else if (novoStatus === 'impressa') {
      updatePayload.impresso_em = new Date().toISOString();
    } else if (novoStatus === 'entregue') {
      updatePayload.entregue_em = new Date().toISOString();
      updatePayload.entregue_para = entreguePara || 'Retirada na Secretaria';
      updatePayload.entregue_por = auth.ctx?.userId || null;
    } else if (novoStatus === 'cancelada') {
      updatePayload.cancelado_em = new Date().toISOString();
      updatePayload.motivo_cancelamento = observacoes || 'Cancelado pela Secretaria';
    }

    if (observacoes) {
      updatePayload.observacoes = observacoes;
    }

    const { data: atualizado, error: updErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    void logDB({
      acao: 'atualizar_status',
      modulo: 'secretaria',
      entidade: 'aemadepa_carteirinhas_solicitacoes',
      entidadeId: id,
      descricao: `Status do pedido de carteirinha alterado para '${novoStatus}'`,
      status: 'sucesso',
      detalhes: { id, de: pedidoAtual.status, para: novoStatus, entreguePara },
    });

    return NextResponse.json({ sucesso: true, pedido: atualizado });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
