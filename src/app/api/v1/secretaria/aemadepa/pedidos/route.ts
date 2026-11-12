/**
 * GET /api/v1/secretaria/aemadepa/pedidos
 * Retorna as solicitações de carteirinhas AEMADEPA com vínculo à associada e ao ministro,
 * discriminando modalidades de pagamento (pix_asaas, a_vista, cortesia) e resumo financeiro.
 *
 * PATCH /api/v1/secretaria/aemadepa/pedidos
 * Atualiza status (em_impressao, impressa, entregue) com rastreabilidade de operador,
 * suporte a confirmação explícita de primeira impressão e reimpressão com motivo mandatório.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'aemadepa');
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
        forma_pagamento,
        operador_aprovacao_id,
        motivo_cortesia,
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
      return NextResponse.json({
        pedidos: [],
        resumo: {
          totalPedidos: 0,
          pedidosPagos: 0,
          totalArrecadado: 0,
          arrecadadoPix: 0,
          arrecadadoAVista: 0,
          totalCortesias: 0,
          aguardandoPagamento: 0,
          emFilaImpressao: 0,
          impressos: 0,
          entregues: 0,
        },
      });
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

      const temFoto = Boolean(assoc?.foto_url && assoc.foto_url.trim().length > 0);
      const regularizada = ['pago', 'em_impressao', 'impressa', 'entregue'].includes(s.status);
      const elegivelImpressao = temFoto && regularizada;

      return {
        id: s.id,
        associadaId: s.associada_id,
        ministroId: s.ministro_id,
        valor: Number(s.valor),
        via: s.via,
        formaPagamento: s.forma_pagamento || 'pix_asaas',
        operadorAprovacaoId: s.operador_aprovacao_id || null,
        motivoCortesia: s.motivo_cortesia || null,
        status: s.status,
        asaasPaymentId: s.asaas_payment_id,
        solicitadoEm: s.solicitado_em,
        pagoEm: s.pago_em,
        impressoEm: s.impresso_em,
        entregueEm: s.entregue_em,
        entreguePara: s.entregue_para,
        observacoes: s.observacoes,
        elegibilidade: {
          temFoto,
          regularizada,
          podeImprimir: elegivelImpressao,
          motivoBloqueio: !temFoto
            ? 'Foto não cadastrada'
            : !regularizada
            ? 'Pagamento pendente'
            : null,
        },
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

    // Resumo financeiro separado: cortesia não compõe receita financeira; PIX e À Vista discriminados
    const pagos = solicitacoes.filter((s) => ['pago', 'em_impressao', 'impressa', 'entregue'].includes(s.status));
    const pagosPix = pagos.filter((s) => (s.forma_pagamento || 'pix_asaas') === 'pix_asaas');
    const pagosAVista = pagos.filter((s) => s.forma_pagamento === 'a_vista');
    const cortesias = pagos.filter((s) => s.forma_pagamento === 'cortesia');

    const arrecadadoPix = pagosPix.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
    const arrecadadoAVista = pagosAVista.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
    const totalArrecadado = arrecadadoPix + arrecadadoAVista; // cortesia tem valor R$ 0,00 e não afeta caixa

    return NextResponse.json({
      pedidos: pedidosFormatados,
      resumo: {
        totalPedidos: solicitacoes.length,
        pedidosPagos: pagos.length,
        totalArrecadado,
        arrecadadoPix,
        arrecadadoAVista,
        totalCortesias: cortesias.length,
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
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.novoStatus) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const { id, novoStatus, entreguePara, observacoes, motivoReimpressao, tipoImpressao } = body;
    const statusValidos = ['pago', 'em_impressao', 'impressa', 'entregue', 'cancelada'];
    if (!statusValidos.includes(novoStatus)) {
      return NextResponse.json({ error: 'Status informado inválido.' }, { status: 400 });
    }

    const operadorId = auth.ctx?.userId;
    const supabase = createServerClient();

    // Busca pedido atual e dados da associada
    const { data: pedidoAtual, error: getErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('*, aemadepa_associadas(id, nome, foto_url)')
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

    // Trava de integridade: antes de autorizar 'em_impressao' ou 'impressa', exige foto e quitação
    if (novoStatus === 'em_impressao' || novoStatus === 'impressa') {
      const temFoto = Boolean(
        pedidoAtual.aemadepa_associadas?.foto_url &&
        pedidoAtual.aemadepa_associadas.foto_url.trim().length > 0
      );
      const regularizado = Boolean(pedidoAtual.pago_em);

      if (!temFoto) {
        return NextResponse.json(
          { error: 'Bloqueio de Emissão: A associada não possui foto 3x4 cadastrada.' },
          { status: 422 }
        );
      }

      if (!regularizado) {
        return NextResponse.json(
          { error: 'Bloqueio de Emissão: Regularização financeira pendente.' },
          { status: 422 }
        );
      }
    }

    const agora = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      status: novoStatus,
      updated_at: agora,
    };

    let ehReimpressao = tipoImpressao === 'reimpressao' || Boolean(pedidoAtual.impresso_em && novoStatus === 'impressa');

    // Se já estiver entregue e for reimpressão, preserva o status 'entregue'
    if (ehReimpressao && pedidoAtual.status === 'entregue') {
      updatePayload.status = 'entregue';
    }

    if (novoStatus === 'impressa' || (ehReimpressao && pedidoAtual.status === 'entregue')) {
      updatePayload.impresso_em = agora;

      // Se já havia sido impressa anteriormente ou explicitamente marcado como reimpressão, exige motivo
      if (ehReimpressao) {
        const motivo = (motivoReimpressao || observacoes || '').trim();
        if (!motivo || motivo.length < 5) {
          return NextResponse.json(
            { error: 'A reimpressão da credencial exige justificativa detalhada (mínimo de 5 caracteres).' },
            { status: 400 }
          );
        }

        // Tenta registrar na tabela de auditoria de impressões
        try {
          await supabase.from('aemadepa_carteirinhas_impressoes').insert({
            solicitacao_id: pedidoAtual.id,
            associada_id: pedidoAtual.associada_id,
            ministro_id: pedidoAtual.ministro_id,
            via: pedidoAtual.via,
            tipo: 'reimpressao',
            motivo_reimpressao: motivo,
            operador_id: operadorId,
            impresso_em: agora,
          });
        } catch (audErr: any) {
          console.warn('[AEMADEPA PEDIDOS] Log na tabela de impressões:', audErr.message);
        }

        updatePayload.observacoes = pedidoAtual.observacoes
          ? `${pedidoAtual.observacoes}\n[Reimpressão em ${new Date().toLocaleString('pt-BR')}] Motivo: ${motivo}`
          : `[Reimpressão em ${new Date().toLocaleString('pt-BR')}] Motivo: ${motivo}`;
      } else {
        // Primeira impressão física confirmada
        try {
          await supabase.from('aemadepa_carteirinhas_impressoes').insert({
            solicitacao_id: pedidoAtual.id,
            associada_id: pedidoAtual.associada_id,
            ministro_id: pedidoAtual.ministro_id,
            via: pedidoAtual.via,
            tipo: 'primeira_impressao',
            operador_id: operadorId,
            impresso_em: agora,
          });
        } catch (audErr: any) {
          console.warn('[AEMADEPA PEDIDOS] Log na tabela de impressões:', audErr.message);
        }
      }
    } else if (novoStatus === 'entregue') {
      updatePayload.entregue_em = agora;
      updatePayload.entregue_para = entreguePara || 'Retirada na Secretaria';
      updatePayload.entregue_por = operadorId || null;
    } else if (novoStatus === 'cancelada') {
      updatePayload.cancelado_em = agora;
      updatePayload.motivo_cancelamento = observacoes || 'Cancelado pela Secretaria';
    }

    if (observacoes && !ehReimpressao) {
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
      acao: ehReimpressao ? 'reimpressao_carteirinha' : 'atualizar_status',
      modulo: 'secretaria',
      entidade: 'aemadepa_carteirinhas_solicitacoes',
      entidadeId: id,
      descricao: ehReimpressao
        ? `Reimpressão da ${pedidoAtual.via}ª via registrada para ${pedidoAtual.aemadepa_associadas?.nome}`
        : `Status do pedido de carteirinha alterado para '${novoStatus}'`,
      status: 'sucesso',
      detalhes: {
        id,
        de: pedidoAtual.status,
        para: novoStatus,
        via: pedidoAtual.via,
        operadorId,
        ehReimpressao,
        motivoReimpressao: motivoReimpressao || null,
        entreguePara,
      },
    });

    return NextResponse.json({ sucesso: true, pedido: atualizado });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
