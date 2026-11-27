import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { prepararSolicitacaoCarteirinha } from '@/lib/umadespa';
import { registrarAuditoria } from '@/lib/audit';

/**
 * GET /api/v1/secretaria/umadespa/pedidos
 * Lista todas as solicitações de carteirinhas UMADESPA com filtros por status e data
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const associadoId = searchParams.get('associadoId');
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));

    let query = supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select(`
        id,
        associado_id,
        via,
        valor,
        validade_meses,
        validade_data,
        idempotency_key,
        status,
        solicitado_em,
        pago_em,
        impresso_em,
        entregue_em,
        cancelado_em,
        motivo_cancelamento,
        entregue_para,
        observacoes,
        created_at,
        associado:umadespa_associados(
          id,
          nome,
          cpf,
          data_nascimento,
          fone,
          email,
          foto_url,
          funcao,
          is_lideranca,
          status,
          supervisao:supervisoes(id, nome),
          campo:campos(id, nome),
          congregacao:congregacoes(id, nome)
        )
      `)
      .order('solicitado_em', { ascending: false })
      .limit(limit);

    if (associadoId) {
      query = query.eq('associado_id', associadoId);
    }

    if (statusFilter && statusFilter !== 'todos') {
      const statuses = statusFilter.split(',');
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0]);
      } else {
        query = query.in('status', statuses);
      }
    }

    const { data: pedidos, error } = await query;

    if (error) {
      console.error('[UMADESPA PEDIDOS API] Erro ao listar pedidos:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: pedidos || [] });
  } catch (err: any) {
    console.error('[UMADESPA PEDIDOS API] Erro fatal em GET /pedidos:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * POST /api/v1/secretaria/umadespa/pedidos
 * Cria manualmente uma solicitação de carteirinha pelo painel administrativo
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || !body.associado_id) {
      return NextResponse.json({ error: 'associado_id é obrigatório.' }, { status: 400 });
    }

    const resultado = await prepararSolicitacaoCarteirinha({
      associadoId: body.associado_id,
      operadorId: auth.ctx.userId,
      observacoes: body.observacoes || null,
    });

    if (resultado.erro || !resultado.solicitacao) {
      return NextResponse.json({ error: resultado.erro || 'Erro ao gerar pedido.' }, { status: 400 });
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user.email,
      modulo: 'secretaria',
      acao: resultado.reutilizada ? 'visualizar' : 'criar',
      entidade: 'umadespa_carteirinhas_solicitacoes',
      entidadeId: resultado.solicitacao.id,
      descricao: `Pedido de carteirinha UMADESPA (via ${resultado.solicitacao.via})`,
    });

    return NextResponse.json({
      data: resultado.solicitacao,
      reutilizada: resultado.reutilizada,
    });
  } catch (err: any) {
    console.error('[UMADESPA PEDIDOS API] Erro fatal em POST /pedidos:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/secretaria/umadespa/pedidos
 * Atualiza status operacional do pedido (em_impressao, impressa, entregue, cancelada)
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.status) {
      return NextResponse.json({ error: 'id e status são obrigatórios.' }, { status: 400 });
    }

    const { id, status, entregue_para, motivo_cancelamento, observacoes, forma_pagamento, justificativa_cortesia } = body;
    const statusValidos = [
      'aguardando_pagamento',
      'processando_pagamento',
      'pago',
      'em_impressao',
      'impressa',
      'entregue',
      'cancelada',
    ];

    if (!statusValidos.includes(status)) {
      return NextResponse.json({ error: `Status inválido. Permitidos: ${statusValidos.join(', ')}` }, { status: 422 });
    }

    const supabase = createServerClient();

    const { data: atual, error: buscaErr } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('*, associado:umadespa_associados(id, nome, cpf)')
      .eq('id', id)
      .maybeSingle();

    if (buscaErr || !atual) {
      return NextResponse.json({ error: 'Pedido de carteirinha não encontrado.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      status,
      updated_at: now,
    };

    // Baixa Manual Restrita a Administradores:
    if (status === 'pago' && !atual.pago_em) {
      // Bloqueio rigoroso de autorização para baixa manual
      if (!auth.ctx.role || !['super', 'admin'].includes(auth.ctx.role)) {
        return NextResponse.json(
          { error: 'Apenas administradores podem registrar baixa manual ou concessão de cortesia.' },
          { status: 403 }
        );
      }

      const forma = forma_pagamento || 'a_vista';
      if (forma === 'cortesia') {
        if (!justificativa_cortesia || String(justificativa_cortesia).trim().length < 5) {
          return NextResponse.json(
            { error: 'Para conceder isenção/cortesia, é obrigatório informar uma justificativa clara (mínimo de 5 caracteres).' },
            { status: 400 }
          );
        }
        updates.forma_pagamento = 'cortesia';
        const obsAtual = atual.observacoes ? `${atual.observacoes}\n` : '';
        updates.observacoes = `${obsAtual}[CORTESIA CONCEDIDA por ${auth.ctx.user.email} em ${now}]: ${String(justificativa_cortesia).trim()}`;
      } else {
        updates.forma_pagamento = 'a_vista';
        const obsAtual = atual.observacoes ? `${atual.observacoes}\n` : '';
        updates.observacoes = `${obsAtual}[BAIXA MANUAL À VISTA por ${auth.ctx.user.email} em ${now}]`;
      }
      updates.pago_em = now;
    }

    // Trava de Impressão e Emissão: impede em_impressao, impressa ou entregue se o pedido não estiver pago
    if (['em_impressao', 'impressa', 'entregue'].includes(status)) {
      const estaPago = Boolean(atual.pago_em || atual.status === 'pago' || status === 'pago');
      if (!estaPago) {
        return NextResponse.json(
          {
            error: 'Impossível avançar para impressão ou entrega sem a confirmação válida do pagamento ou isenção administrativa.',
          },
          { status: 422 }
        );
      }
    }

    if (status === 'em_impressao') {
      if (!atual.impresso_em) {
        updates.impresso_em = now;
      }
    } else if (status === 'impressa') {
      if (!atual.impresso_em) {
        updates.impresso_em = now;
      }
    } else if (status === 'entregue') {
      updates.entregue_em = now;
      updates.entregue_por = auth.ctx.userId;
      if (entregue_para) {
        updates.entregue_para = String(entregue_para).trim();
      }
    } else if (status === 'cancelada') {
      // Bloqueio rigoroso: nunca cancela pedido que já foi pago
      if (atual.pago_em && (!auth.ctx.role || !['super', 'admin'].includes(auth.ctx.role))) {
        return NextResponse.json({ error: 'Pedidos pagos não podem ser cancelados sem permissão de superadministrador.' }, { status: 403 });
      }
      updates.cancelado_em = now;
      updates.motivo_cancelamento = motivo_cancelamento ? String(motivo_cancelamento).trim() : 'Cancelamento administrativo';
    }

    if (observacoes !== undefined) {
      updates.observacoes = observacoes ? String(observacoes).trim() : null;
    }

    const { data: atualizado, error: updErr } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr || !atualizado) {
      console.error('[UMADESPA PEDIDOS API] Erro ao atualizar status:', updErr);
      return NextResponse.json({ error: updErr?.message || 'Erro ao atualizar pedido.' }, { status: 500 });
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user.email,
      modulo: 'secretaria',
      acao: 'editar',
      entidade: 'umadespa_carteirinhas_solicitacoes',
      entidadeId: id,
      descricao: `Status do pedido de carteirinha UMADESPA alterado para ${status}`,
    });

    return NextResponse.json({ data: atualizado });
  } catch (err: any) {
    console.error('[UMADESPA PEDIDOS API] Erro fatal em PATCH /pedidos:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
