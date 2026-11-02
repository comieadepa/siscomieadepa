import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';
import { criarNotificacaoMinistro } from '@/lib/notificacoes-ministro';

const resolveToken = (request: NextRequest) => {
  const direct = request.headers.get('asaas-access-token') || request.headers.get('access_token');
  if (direct) return direct;

  const auth = request.headers.get('authorization');
  if (!auth) return null;
  return auth.replace('Bearer ', '');
};

export async function POST(request: NextRequest) {
  try {
    const asaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!asaasWebhookToken) {
      console.error('[ASAAS WEBHOOK] ASAAS_WEBHOOK_TOKEN não configurado — request rejeitado');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = resolveToken(request);
    if (!token || token !== asaasWebhookToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    const event = String(payload?.event || '').toUpperCase();
    const payment = payload?.payment;
    const asaasPaymentId = payment?.id;

    if (!asaasPaymentId) {
      return NextResponse.json({ error: 'Pagamento nao informado' }, { status: 400 });
    }

    const statusMap: Record<string, string> = {
      PAYMENT_CONFIRMED: 'paid',
      PAYMENT_RECEIVED: 'paid',
      PAYMENT_OVERDUE: 'overdue',
      PAYMENT_DELETED: 'cancelled',
      PAYMENT_CANCELED: 'cancelled',
      PAYMENT_REFUNDED: 'cancelled',
    };

    const nextStatus = statusMap[event];
    const paymentDate = payment?.paymentDate || payment?.confirmedDate || null;

    const supabase = createServerClient();

    const updatePayload: Record<string, any> = {
      asaas_response: payload,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus) {
      updatePayload.status = nextStatus;
    }

    if (paymentDate) {
      updatePayload.payment_date = paymentDate;
    }

    // ── Lote de inscrições AGO (esposa / grupo) ──────────────────────────────
    const externalRef = String(payment?.externalReference || '');
    if (externalRef.startsWith('lote:') && (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED')) {
      const loteId = externalRef.replace('lote:', '');
      if (loteId) {
        await supabase
          .from('evento_inscricoes')
          .update({ status_pagamento: 'pago', forma_pagamento: 'pix' })
          .eq('lote_id', loteId);
        await supabase
          .from('evento_lotes_inscricao')
          .update({ status_pagamento: 'pago', asaas_payment_id: asaasPaymentId })
          .eq('id', loteId);

        // Executa autoalocação automática para os participantes do lote
        const { data: loteIns } = await supabase
          .from('evento_inscricoes')
          .select('id')
          .eq('lote_id', loteId);

        for (const li of loteIns ?? []) {
          await alocarLeitoParaInscricao(supabase, li.id);
        }
      }
      return NextResponse.json({ received: true });
    }

    // ── Credencial impressão ─────────────────────────────────────────────────
    if (externalRef.startsWith('credencial_impressao:')) {
      const solicitacaoId = externalRef.replace('credencial_impressao:', '');
      if (
        solicitacaoId &&
        (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED')
      ) {
        const { data: updatedSolicitacao, error: impErr } = await supabase
          .from('credencial_impressoes_solicitacoes')
          .update({
            status: 'pago_pendente_impressao',
            asaas_payment_id: asaasPaymentId,
            pago_em: paymentDate || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', solicitacaoId)
          .eq('status', 'aguardando_pagamento') // Idempotente: atualiza apenas se estava aguardando
          .select('id, ministro_id')
          .maybeSingle();

        if (impErr) {
          console.error('[ASAAS WEBHOOK] Erro ao atualizar impressão:', impErr.message);
        } else if (updatedSolicitacao?.ministro_id) {
          void logDB({
            acao: 'editar',
            modulo: 'portal_ministro',
            entidade: 'credencial_impressao',
            entidadeId: solicitacaoId,
            descricao: `Pagamento confirmado pelo ASAAS: ${asaasPaymentId}`,
            status: 'sucesso',
            detalhes: { event, asaasPaymentId, externalRef },
          });

          // Dispara notificação automática (In-App e E-mail via Resend)
          try {
            await criarNotificacaoMinistro({
              ministroId: updatedSolicitacao.ministro_id,
              tipo: 'credencial',
              titulo: 'Pagamento da Credencial Confirmado',
              mensagem: 'O pagamento da sua taxa de impressão foi confirmado com sucesso. Sua credencial física foi encaminhada para a fila de produção da Secretaria.',
              linkAcao: '/portal-ministro/credencial',
              canal: 'ambos',
            });
          } catch (notifErr: any) {
            console.error('[ASAAS WEBHOOK] Erro ao disparar notificação de pagamento:', notifErr?.message);
          }

          // Notificação administrativa para a equipe da Secretaria
          try {
            const { data: notifExiste } = await supabase
              .from('admin_notifications')
              .select('id')
              .eq('type', 'credencial_impressao')
              .contains('data', { solicitacao_id: solicitacaoId })
              .maybeSingle();

            if (!notifExiste) {
              const { data: membro } = await supabase
                .from('members')
                .select('name')
                .eq('id', updatedSolicitacao.ministro_id)
                .maybeSingle();

              const ministroNome = membro?.name || 'Ministro';

              await supabase
                .from('admin_notifications')
                .insert({
                  type: 'credencial_impressao',
                  title: 'Nova Credencial Pronta para Impressão',
                  message: `O ministro ${ministroNome} efetuou o pagamento da taxa de impressão da credencial física.`,
                  data: {
                    solicitacao_id: solicitacaoId,
                    ministro_id: updatedSolicitacao.ministro_id,
                    ministro_nome: ministroNome,
                    asaas_payment_id: asaasPaymentId,
                    link: '/secretaria/impressoes-credenciais',
                  },
                  is_read: false,
                });
            }
          } catch (adminNotifErr: any) {
            console.error('[ASAAS WEBHOOK] Erro ao criar notificação administrativa:', adminNotifErr?.message);
          }
        }

        return NextResponse.json({ received: true });
      }
      return NextResponse.json({ received: true });
    }

    // ── Credenciamento CONEC (Anuidade Instituição) ──────────────────────────
    const isConecEvent = externalRef.startsWith('conec_credenciamento:') || externalRef.startsWith('conec:');
    
    // Suporte tanto ao formato novo com externalReference quanto à busca por asaas_payment_id existente
    let conecCredQuery = supabase.from('conec_credenciamentos').select('*, conec_instituicoes(nome_instituicao)').is('deleted_at', null);

    if (isConecEvent) {
      const credId = externalRef.replace(/^conec_credenciamento:|^conec:/, '');
      conecCredQuery = conecCredQuery.eq('id', credId);
    } else {
      conecCredQuery = conecCredQuery.eq('asaas_payment_id', asaasPaymentId);
    }

    const { data: targetCred, error: conecLookupErr } = await conecCredQuery.maybeSingle();

    if (!conecLookupErr && targetCred) {
      // 1. Validação de Vínculo do ID da Cobrança: se o credenciamento já tiver cobrança vinculada, deve bater exatamente com o payment ID recebido
      if (targetCred.asaas_payment_id && targetCred.asaas_payment_id !== asaasPaymentId) {
        console.error(`[ASAAS WEBHOOK CONEC] Inconsistência de Payment ID para credenciamento ${targetCred.id}: cadastrado ${targetCred.asaas_payment_id}, recebido ${asaasPaymentId}`);
        void logDB({
          acao: 'erro_critico',
          modulo: 'financeiro',
          entidade: 'conec_credenciamentos',
          entidadeId: targetCred.id,
          descricao: `Tentativa de quitação com Payment ID divergente: esperado ${targetCred.asaas_payment_id}, recebido ${asaasPaymentId}`,
          status: 'erro',
          detalhes: { asaasPaymentId, cadastrado: targetCred.asaas_payment_id, externalRef },
        });
        return NextResponse.json({ error: 'Payment ID divergente' }, { status: 400 });
      }

      const isPaidEvent = event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_RECEIVED_IN_CASH';
      const isOverdueEvent = event === 'PAYMENT_OVERDUE';
      const isCancelEvent = event === 'PAYMENT_DELETED' || event === 'PAYMENT_CANCELED' || event === 'PAYMENT_REFUNDED';

      if (isPaidEvent) {
        // 2. Validação estrita do valor efetivamente devido (targetCred.valor ou padrão R$ 800)
        const valorRecebido = Number(payment?.value || 0);
        const valorEsperado = Number(targetCred.valor || 800.00);

        // Não aceita pagamentos com valor inferior ou divergência superior a centavos da taxa devida
        const diferenca = Math.abs(valorRecebido - valorEsperado);
        if (valorRecebido <= 0 || diferenca > 0.05) {
          console.error(`[ASAAS WEBHOOK CONEC] Valor divergente do devido para credenciamento ${targetCred.id}: Recebido R$ ${valorRecebido}, Devido R$ ${valorEsperado}`);
          void logDB({
            acao: 'erro_critico',
            modulo: 'financeiro',
            entidade: 'conec_credenciamentos',
            entidadeId: targetCred.id,
            descricao: `Valor divergente do montante devido no pagamento CONEC: recebido R$ ${valorRecebido}, devido R$ ${valorEsperado}`,
            status: 'erro',
            detalhes: { asaasPaymentId, externalRef, valorRecebido, valorEsperado, diferenca },
          });
          return NextResponse.json({ error: 'Valor divergente do devido' }, { status: 422 });
        }

        // Idempotência: Se já está pago e ativo, não reprocessa nem gera duplicidade
        if (targetCred.status_pagamento === 'pago' && targetCred.status_credenciamento === 'ativo') {
          console.log(`[ASAAS WEBHOOK CONEC] Pagamento já confirmado anteriormente para credenciamento ${targetCred.id} (Idempotente).`);
          return NextResponse.json({ received: true, status: 'already_processed' });
        }

        const billingType = String(payment?.billingType || 'pix').toLowerCase();
        const dataPagto = paymentDate || new Date().toISOString();

        const { error: conecUpdateErr } = await supabase
          .from('conec_credenciamentos')
          .update({
            status_pagamento: 'pago',
            status_credenciamento: 'ativo',
            data_pagamento: dataPagto,
            data_emissao: targetCred.data_emissao || new Date().toISOString(),
            forma_pagamento: billingType,
            asaas_payment_id: asaasPaymentId,
            asaas_status: event,
            observacoes_financeiras: targetCred.observacoes_financeiras 
              ? `${targetCred.observacoes_financeiras}\n[Webhook Asaas] Pagamento confirmado via ${billingType.toUpperCase()} em ${new Date().toLocaleString('pt-BR')}`
              : `[Webhook Asaas] Pagamento confirmado via ${billingType.toUpperCase()} em ${new Date().toLocaleString('pt-BR')}`,
          })
          .eq('id', targetCred.id)
          .eq('status_pagamento', 'pendente'); // trava atômica de idempotência

        if (conecUpdateErr) {
          console.error('[ASAAS WEBHOOK CONEC] Erro ao atualizar credenciamento:', conecUpdateErr.message);
          return NextResponse.json({ error: conecUpdateErr.message }, { status: 500 });
        }

        // Registro de auditoria financeira
        void logDB({
          acao: 'baixa_financeira',
          modulo: 'financeiro',
          entidade: 'conec_credenciamentos',
          entidadeId: targetCred.id,
          descricao: `Pagamento CONEC confirmado via Asaas (${billingType.toUpperCase()}): ${targetCred.numero_registro}`,
          status: 'sucesso',
          detalhes: {
            asaasPaymentId,
            externalRef,
            instituicaoId: targetCred.instituicao_id,
            anoReferencia: targetCred.ano_referencia,
            valor: valorRecebido || valorEsperado,
            billingType,
            dataPagamento: dataPagto,
          },
        });

        return NextResponse.json({ received: true, updated: targetCred.id });
      }

      if (isOverdueEvent) {
        await supabase
          .from('conec_credenciamentos')
          .update({
            asaas_status: 'OVERDUE',
            observacoes_financeiras: targetCred.observacoes_financeiras
              ? `${targetCred.observacoes_financeiras}\n[Asaas] Cobrança vencida.`
              : '[Asaas] Cobrança vencida.',
          })
          .eq('id', targetCred.id);
        return NextResponse.json({ received: true, status: 'overdue' });
      }

      if (isCancelEvent) {
        // Se a cobrança for cancelada ou estornada no Asaas
        if (targetCred.status_pagamento !== 'pago') {
          await supabase
            .from('conec_credenciamentos')
            .update({
              status_pagamento: 'cancelado',
              status_credenciamento: 'cancelado',
              asaas_status: event,
            })
            .eq('id', targetCred.id);
        }
        return NextResponse.json({ received: true, status: 'cancelled' });
      }

      return NextResponse.json({ received: true, note: 'event_ignored_for_conec' });
    }

    // ── Pagamentos mensalidade ───────────────────────────────────────────────
    const { error } = await supabase
      .from('payments')
      .update(updatePayload)
      .eq('asaas_payment_id', asaasPaymentId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
