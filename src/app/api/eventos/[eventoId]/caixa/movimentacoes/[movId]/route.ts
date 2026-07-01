import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/eventos/[eventoId]/caixa/movimentacoes/[movId]
 *
 * Cancela (soft-delete) uma movimentação do caixa.
 * Aceita dois tipos de movimentação:
 *  - tipo = 'inscricao'   → reverte status_pagamento de evento_inscricoes para 'pendente'
 *  - tipo = 'complemento' → cancela evento_ordens_pagamento (status = 'cancelado')
 *
 * Permissões:
 *  - admin_evento / global (super/administrador): acesso irrestrito.
 *  - operador: acesso permitido, MAS somente a movimentações vinculadas
 *    à sua própria sessão de caixa (caixa_sessao_id pertencente ao operador).
 *
 * Regras invariáveis:
 *  - Não apaga registros — apenas altera status.
 *  - Não remove check-in, QR code ou dados de hospedagem.
 *  - Registra log de auditoria no campo observacoes + role do operador.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; movId: string }> },
) {
  const { eventoId, movId } = await params;

  // ── Guard: 'inscricoes' é acessível pelo papel 'operador' ────────────────
  // A restrição de escopo (somente caixa próprio) é aplicada abaixo em runtime.
  const guard = await requireEventoPermission(req, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const role = guard.ctx.role;
  const equipeId = guard.ctx.equipe?.id ?? null;

  // ── Somente 'operador' tem restrição adicional de escopo de caixa ────────
  // admin_evento, global (super/admin) passam livremente.
  const isOperadorRestrito = role === 'operador';

  // Se for operador, identificar a sessão de caixa ativa dele
  let sessaoOperadorId: string | null = null;
  if (isOperadorRestrito && equipeId) {
    const { data: sessao } = await supabase
      .from('evento_caixa_sessoes')
      .select('id')
      .eq('evento_id', eventoId)
      .eq('operador_id', equipeId)
      .eq('status', 'aberto')
      .maybeSingle();
    sessaoOperadorId = sessao?.id ?? null;
  }

  let body: { tipo: 'inscricao' | 'complemento'; motivo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const { tipo, motivo } = body;
  if (!tipo || !['inscricao', 'complemento'].includes(tipo)) {
    return NextResponse.json({ error: 'Campo "tipo" deve ser "inscricao" ou "complemento".' }, { status: 400 });
  }

  const operadorNome =
    guard.ctx.user?.email ??
    equipeId ??
    'Administrador';

  const logMotivo = motivo?.trim() || 'Remoção de duplicidade solicitada pelo operador.';
  const logRole   = role;

  // ── CASO 1: Inscrição do balcão ─────────────────────────────────────────
  if (tipo === 'inscricao') {
    const { data: ins, error: fetchErr } = await supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, status_pagamento, forma_pagamento, valor_pago, observacoes, evento_id, origem, caixa_sessao_id, operador_id')
      .eq('id', movId)
      .eq('evento_id', eventoId)
      .maybeSingle();

    if (fetchErr || !ins) {
      return NextResponse.json({ error: 'Inscrição não localizada.' }, { status: 404 });
    }

    // ── Verificação de escopo para Operador ──────────────────────────────
    if (isOperadorRestrito) {
      // Deve ter uma sessão aberta
      if (!sessaoOperadorId) {
        return NextResponse.json({
          error: 'Operador não possui sessão de caixa aberta. Apenas movimentações do próprio caixa podem ser removidas.',
        }, { status: 403 });
      }
      // A inscrição deve pertencer à sessão de caixa do operador
      const insCSId = (ins as any).caixa_sessao_id;
      if (insCSId !== sessaoOperadorId) {
        return NextResponse.json({
          error: 'Esta movimentação não pertence à sua sessão de caixa. Somente administradores podem remover movimentações de outros caixas.',
        }, { status: 403 });
      }
    }

    if (ins.status_pagamento === 'cancelado') {
      return NextResponse.json({ error: 'Esta movimentação já está cancelada.' }, { status: 409 });
    }

    // Reverte para pendente e registra auditoria
    const tsAudit   = new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' });
    const linhaAudit = `[${tsAudit}] CANCELAMENTO por ${operadorNome} (papel: ${logRole}): ${logMotivo} (era ${ins.status_pagamento} / ${ins.forma_pagamento} / R$ ${Number(ins.valor_pago ?? 0).toFixed(2)})`;
    const novasObs   = ins.observacoes ? `${ins.observacoes}\n${linhaAudit}` : linhaAudit;

    const { error: updErr } = await supabase
      .from('evento_inscricoes')
      .update({
        status_pagamento: 'pendente',
        forma_pagamento:  null,
        valor_pago:       0,
        caixa_sessao_id:  null,
        observacoes:      novasObs,
      })
      .eq('id', movId)
      .eq('evento_id', eventoId);

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao cancelar inscrição: ' + updErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      tipo: 'inscricao',
      id: movId,
      novo_status: 'pendente',
      mensagem: `Movimentação de inscrição de "${ins.nome_inscrito}" revertida para pendente.`,
    });
  }

  // ── CASO 2: Complemento de pagamento (evento_ordens_pagamento) ──────────
  if (tipo === 'complemento') {
    const { data: ord, error: fetchErr } = await supabase
      .from('evento_ordens_pagamento')
      .select('id, status, valor, metadata, evento_id, inscricao_id')
      .eq('id', movId)
      .eq('evento_id', eventoId)
      .maybeSingle();

    if (fetchErr || !ord) {
      return NextResponse.json({ error: 'Complemento de pagamento não localizado.' }, { status: 404 });
    }

    // ── Verificação de escopo para Operador ──────────────────────────────
    if (isOperadorRestrito) {
      if (!sessaoOperadorId) {
        return NextResponse.json({
          error: 'Operador não possui sessão de caixa aberta.',
        }, { status: 403 });
      }
      // Verifica se a inscrição vinculada ao complemento pertence à sessão do operador
      const insId = (ord as any).inscricao_id;
      if (insId) {
        const { data: insVinc } = await supabase
          .from('evento_inscricoes')
          .select('caixa_sessao_id')
          .eq('id', insId)
          .maybeSingle();

        if ((insVinc as any)?.caixa_sessao_id !== sessaoOperadorId) {
          return NextResponse.json({
            error: 'Este complemento não pertence à sua sessão de caixa.',
          }, { status: 403 });
        }
      }
    }

    if (ord.status === 'cancelado') {
      return NextResponse.json({ error: 'Esta movimentação já está cancelada.' }, { status: 409 });
    }

    const metaAtualizado = {
      ...(ord.metadata ?? {}),
      cancelado_por:         operadorNome,
      cancelado_em:          new Date().toISOString(),
      motivo_cancelamento:   logMotivo,
      papel_operador:        logRole,
    };

    const { error: updErr } = await supabase
      .from('evento_ordens_pagamento')
      .update({ status: 'cancelado', metadata: metaAtualizado })
      .eq('id', movId)
      .eq('evento_id', eventoId);

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao cancelar complemento: ' + updErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      tipo: 'complemento',
      id: movId,
      novo_status: 'cancelado',
      mensagem: `Complemento de R$ ${Number(ord.valor ?? 0).toFixed(2)} cancelado com sucesso.`,
    });
  }

  return NextResponse.json({ error: 'Tipo não tratado.' }, { status: 400 });
}
