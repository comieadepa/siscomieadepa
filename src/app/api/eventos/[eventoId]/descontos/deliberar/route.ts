import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'supervisor_descontos');
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const {
      solicitacao_id,
      acao, // 'autorizar' | 'negar'
      valor_desconto,
      justificativa,
      supervisor_nome,
    } = body;

    if (!solicitacao_id || typeof solicitacao_id !== 'string') {
      return NextResponse.json({ error: 'ID da solicitação é obrigatório.' }, { status: 400 });
    }
    if (acao !== 'autorizar' && acao !== 'negar') {
      return NextResponse.json({ error: 'Ação deve ser autorizar ou negar.' }, { status: 400 });
    }

    const admin = guard.ctx.supabaseAdmin;

    const { data: solicitacao, error: fetchErr } = await admin
      .from('evento_desconto_autorizacoes')
      .select('*')
      .eq('id', solicitacao_id)
      .eq('evento_id', eventoId)
      .single();

    if (fetchErr || !solicitacao) {
      return NextResponse.json({ error: 'Solicitação de desconto não encontrada.' }, { status: 404 });
    }

    if (solicitacao.status !== 'pendente') {
      return NextResponse.json(
        { error: `Esta solicitação já foi ${solicitacao.status} anteriormente e não pode ser alterada.` },
        { status: 409 }
      );
    }

    const supNome = supervisor_nome?.trim()
      || guard.ctx.user?.user_metadata?.full_name
      || guard.ctx.user?.user_metadata?.nome
      || guard.ctx.user?.email
      || 'Supervisor de Descontos';
    const supEmail = guard.ctx.user?.email || null;
    const supId = guard.ctx.user?.id || null;
    const motivoDelib = justificativa?.trim() || null;

    if (acao === 'negar') {
      const updateData: Record<string, any> = {
        status: 'negado',
        supervisor_id: supId,
        supervisor_user_id: supId,
        supervisor_nome: supNome,
        supervisor_email: supEmail,
        justificativa_supervisor: motivoDelib,
        motivo_deliberacao: motivoDelib,
        deliberado_em: new Date().toISOString(),
      };

      let { data: negada, error: negErr } = await admin
        .from('evento_desconto_autorizacoes')
        .update(updateData)
        .eq('id', solicitacao_id)
        .eq('status', 'pendente')
        .select('*')
        .single();

      if (negErr && (negErr.message?.includes('column') || negErr.code === 'PGRST204')) {
        const fallbackNegada: Record<string, any> = {
          status: 'negado',
          supervisor_user_id: supId,
          supervisor_nome: supNome,
          supervisor_email: supEmail,
          motivo_deliberacao: motivoDelib,
          deliberado_em: new Date().toISOString(),
        };
        const retry = await admin
          .from('evento_desconto_autorizacoes')
          .update(fallbackNegada)
          .eq('id', solicitacao_id)
          .eq('status', 'pendente')
          .select('*')
          .single();
        if (!retry.error && retry.data) {
          negada = retry.data;
          negErr = null;
        }
      }

      if (negErr || !negada) {
        return NextResponse.json({ error: 'Erro ao negar solicitação de desconto.' }, { status: 500 });
      }

      void logDB({
        userId: guard.ctx.user?.id,
        userEmail: supEmail || undefined,
        acao: 'negar_desconto_balcao',
        modulo: 'eventos',
        entidade: 'evento_desconto_autorizacoes',
        entidadeId: solicitacao_id,
        descricao: `Desconto negado para ${solicitacao.nome_inscrito} pelo supervisor ${supNome}.`,
        status: 'sucesso',
        detalhes: { evento_id: eventoId, solicitacao_id, motivo: justificativa },
        request,
      });

      return NextResponse.json({ success: true, solicitacao: negada });
    }

    // Ação: AUTORIZAR
    const valorOriginal = Number(solicitacao.valor_original);
    const descontoNum = Number(valor_desconto);

    if (isNaN(descontoNum) || descontoNum <= 0) {
      return NextResponse.json({ error: 'O valor do desconto deve ser maior que zero.' }, { status: 400 });
    }

    const descontoFix = Math.round(descontoNum * 100) / 100;

    if (descontoFix > valorOriginal) {
      return NextResponse.json({
        error: `O valor do desconto (R$ ${descontoFix.toFixed(2)}) não pode ser superior ao valor original (R$ ${valorOriginal.toFixed(2)}).`
      }, { status: 400 });
    }

    const valorFinalFix = Math.round((valorOriginal - descontoFix) * 100) / 100;

    const updateAuthData: Record<string, any> = {
      status: 'autorizado',
      valor_desconto: descontoFix,
      valor_final: valorFinalFix,
      supervisor_id: supId,
      supervisor_user_id: supId,
      supervisor_nome: supNome,
      supervisor_email: supEmail,
      justificativa_supervisor: motivoDelib,
      motivo_deliberacao: motivoDelib,
      deliberado_em: new Date().toISOString(),
    };

    let { data: autorizada, error: autErr } = await admin
      .from('evento_desconto_autorizacoes')
      .update(updateAuthData)
      .eq('id', solicitacao_id)
      .eq('status', 'pendente')
      .select('*')
      .single();

    if (autErr && (autErr.message?.includes('column') || autErr.code === 'PGRST204')) {
      const fallbackAuth: Record<string, any> = {
        status: 'autorizado',
        valor_desconto: descontoFix,
        valor_final: valorFinalFix,
        supervisor_user_id: supId,
        supervisor_nome: supNome,
        supervisor_email: supEmail,
        motivo_deliberacao: motivoDelib,
        deliberado_em: new Date().toISOString(),
      };
      const retryAuth = await admin
        .from('evento_desconto_autorizacoes')
        .update(fallbackAuth)
        .eq('id', solicitacao_id)
        .eq('status', 'pendente')
        .select('*')
        .single();
      if (!retryAuth.error && retryAuth.data) {
        autorizada = retryAuth.data;
        autErr = null;
      }
    }

    if (autErr || !autorizada) {
      return NextResponse.json({ error: 'Erro ou conflito de concorrência ao autorizar desconto.' }, { status: 500 });
    }

    // ── Regularização Financeira Automática para Desconto Retroativo ──
    let regularizacaoRetroativa: any = null;
    if (solicitacao.inscricao_id) {
      try {
        const { data: inscrAtual, error: fetchInscrErr } = await admin
          .from('evento_inscricoes')
          .select('id, valor_pago, valor_original, valor_final, desconto_valor, observacoes, ministro_snapshot, forma_pagamento, status_pagamento, caixa_sessao_id')
          .eq('id', solicitacao.inscricao_id)
          .eq('evento_id', eventoId)
          .single();

        if (!fetchInscrErr && inscrAtual) {
          const vOriginalAtual = Number(inscrAtual.valor_original ?? valorOriginal);
          const novoValorFinal = Math.max(0, Math.round((vOriginalAtual - descontoFix) * 100) / 100);
          const novoDescontoTotal = Math.round(descontoFix * 100) / 100;
          const novoValorPago = novoValorFinal; // Ajusta o valor efetivamente retido/reconhecido

          // Auditoria no snapshot e observações
          const snapAtual = (inscrAtual.ministro_snapshot ?? {}) as Record<string, any>;
          snapAtual.desconto_retroativo_regularizado = {
            autorizacao_id: solicitacao_id,
            supervisor_nome: supNome,
            supervisor_id: supId,
            valor_original: vOriginalAtual,
            valor_desconto: descontoFix,
            valor_final_corrigido: novoValorFinal,
            regularizado_em: new Date().toISOString(),
          };

          const obsAjustada = `${inscrAtual.observacoes ? inscrAtual.observacoes + ' | ' : ''}[Desconto retroativo: -R$ ${descontoFix.toFixed(2)} por ${supNome}]`.trim();

          const { data: inscrAtualizada, error: updInscrErr } = await admin
            .from('evento_inscricoes')
            .update({
              valor_original: vOriginalAtual,
              desconto_valor: novoDescontoTotal,
              valor_final: novoValorFinal,
              valor_pago: novoValorPago,
              ministro_snapshot: snapAtual,
              observacoes: obsAjustada,
              updated_at: new Date().toISOString(),
            })
            .eq('id', solicitacao.inscricao_id)
            .select('id, valor_pago, valor_final, desconto_valor')
            .single();

          if (!updInscrErr && inscrAtualizada) {
            // Marcar a autorização como utilizada imediatamente
            await admin
              .from('evento_desconto_autorizacoes')
              .update({
                utilizado: true,
                utilizado_em: new Date().toISOString(),
              })
              .eq('id', solicitacao_id);

            // Ajuste auditável no caixa caso a inscrição pertença a uma sessão fechada
            if (inscrAtual.caixa_sessao_id && inscrAtual.forma_pagamento === 'dinheiro') {
              try {
                const { data: sessaoCaixa } = await admin
                  .from('evento_caixa_sessoes')
                  .select('id, status, saldo_dinheiro_esperado, saldo_dinheiro_informado, observacoes')
                  .eq('id', inscrAtual.caixa_sessao_id)
                  .single();

                if (sessaoCaixa && sessaoCaixa.status === 'fechado') {
                  const saldoEspAntigo = Number(sessaoCaixa.saldo_dinheiro_esperado || 0);
                  const novoSaldoEsp = Math.max(0, Math.round((saldoEspAntigo - descontoFix) * 100) / 100);
                  const obsCaixa = `${sessaoCaixa.observacoes ? sessaoCaixa.observacoes + ' | ' : ''}[Ajuste auditável: Desconto retroativo -R$ ${descontoFix.toFixed(2)} ref. inscrição ${inscrAtual.id}]`.trim();

                  await admin
                    .from('evento_caixa_sessoes')
                    .update({
                      saldo_dinheiro_esperado: novoSaldoEsp,
                      observacoes: obsCaixa,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', sessaoCaixa.id);
                }
              } catch (caixaErr) {
                console.error('[DESCONTO DELIBERAR] Aviso ao ajustar sessão de caixa:', caixaErr);
              }
            }

            regularizacaoRetroativa = {
              sucesso: true,
              inscricao_id: solicitacao.inscricao_id,
              valor_antigo: inscrAtual.valor_pago,
              valor_novo: novoValorPago,
              desconto_aplicado: descontoFix,
            };
          } else {
            console.error('[DESCONTO DELIBERAR] Erro ao atualizar inscrição retroativa:', updInscrErr);
          }
        }
      } catch (retroErr) {
        console.error('[DESCONTO DELIBERAR] Falha na regularização retroativa:', retroErr);
      }
    }

    void logDB({
      userId: guard.ctx.user?.id,
      userEmail: supEmail || undefined,
      acao: 'autorizar_desconto_balcao',
      modulo: 'eventos',
      entidade: 'evento_desconto_autorizacoes',
      entidadeId: solicitacao_id,
      descricao: `Desconto de R$ ${descontoFix.toFixed(2)} autorizado para ${solicitacao.nome_inscrito}${solicitacao.inscricao_id ? ' (RETROATIVO)' : ''}. Valor final: R$ ${valorFinalFix.toFixed(2)}.`,
      status: 'sucesso',
      detalhes: {
        evento_id: eventoId,
        solicitacao_id,
        valor_original: valorOriginal,
        valor_desconto: descontoFix,
        valor_final: valorFinalFix,
        inscricao_id: solicitacao.inscricao_id || null,
        regularizacao_retroativa: regularizacaoRetroativa,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      solicitacao: autorizada,
      regularizacao_retroativa: regularizacaoRetroativa,
    });
  } catch (err: any) {
    console.error('[DESCONTO DELIBERAR] Falha geral:', err);
    return NextResponse.json({ error: 'Falha interna ao deliberar solicitação de desconto.' }, { status: 500 });
  }
}
