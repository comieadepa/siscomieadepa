import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';
import { enqueueWebhookJobs } from '@/lib/jobs/webhook-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

function resolveToken(request: NextRequest): string | null {
  const direct = request.headers.get('asaas-access-token') || request.headers.get('access_token');
  if (direct) return direct;
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  return auth.replace('Bearer ', '');
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Webhook ASAAS ativo',
    method: 'GET',
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.time("ASAAS_WEBHOOK_TOTAL");
  
  // 0. Lê payload PRIMEIRO — log antes de qualquer validação
  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    console.error('[EVENTOS WEBHOOK] Body inválido — não é JSON');
    console.timeEnd("ASAAS_WEBHOOK_TOTAL");
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const eventId = String(payload?.id ?? '');
  const event   = String(payload?.event || '').toUpperCase();
  const payment = payload?.payment as Record<string, unknown> | undefined;
  const asaasId = String(payment?.id ?? '');
  const extRef  = String(payment?.externalReference ?? '');

  // Log inicial — registrado ANTES de qualquer validação de token
  console.log('[EVENTOS WEBHOOK] ▶ Evento recebido', {
    eventId,
    event,
    paymentId: asaasId || '(ausente)',
    externalReference: extRef || '(ausente)',
    timestamp: new Date().toISOString(),
  });

  try {
    // 1. Valida token
    if (!ASAAS_WEBHOOK_TOKEN) {
      console.error('[EVENTOS WEBHOOK] ASAAS_WEBHOOK_TOKEN não configurado');
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      void logDB({ acao: 'erro_critico', modulo: 'eventos', entidade: 'webhook', descricao: 'ASAAS_WEBHOOK_TOKEN não configurado', status: 'erro', detalhes: { event, paymentId: asaasId } });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = resolveToken(request);
    if (!token || token !== ASAAS_WEBHOOK_TOKEN) {
      console.warn('[EVENTOS WEBHOOK] Token inválido — acesso negado', { event, paymentId: asaasId });
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      void logDB({ acao: 'erro_critico', modulo: 'eventos', entidade: 'webhook', descricao: 'Token de webhook inválido', status: 'erro', detalhes: { event, paymentId: asaasId } });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Payload já lido — valida payment ID
    if (!asaasId) {
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      void logDB({ acao: 'erro_critico', modulo: 'eventos', entidade: 'webhook', descricao: 'Payment ID ausente no payload', status: 'erro', detalhes: { event, rawPayload: { eventId } } });
      return NextResponse.json({ error: 'Payment ID ausente' }, { status: 400 });
    }

    // 3. Mapeamento de status
    const statusMap: Record<string, string> = {
      PAYMENT_CONFIRMED:       'pago',
      PAYMENT_RECEIVED:        'pago',
      PAYMENT_RECEIVED_IN_CASH:'pago',
      PAYMENT_OVERDUE:         'pendente',  // Vencido mas ainda pendente (não cancela)
      PAYMENT_DELETED:         'cancelado',
      PAYMENT_CANCELED:        'cancelado',
      PAYMENT_REFUNDED:        'cancelado',
    };

    const novoStatus = statusMap[event];
    if (!novoStatus) {
      // Evento não mapeado — aceita sem processar
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    const supabase = createServerClient();

    // 4. Verifica se é cobrança de lote (externalReference inicia com "lote:")
    if (extRef.startsWith('lote:')) {
      const loteId = extRef.slice(5);

      // Busca o status atual para idempotência rápida baseada no estado do banco
      const { data: loteCurrent, error: fetchLoteErr } = await supabase
        .from('evento_lotes_inscricao')
        .select('status_pagamento')
        .eq('id', loteId)
        .maybeSingle();

      if (fetchLoteErr) {
        console.error('[EVENTOS WEBHOOK] Erro ao buscar lote:', fetchLoteErr.message);
        console.timeEnd("ASAAS_WEBHOOK_TOTAL");
        return NextResponse.json({ error: fetchLoteErr.message }, { status: 500 });
      }

      if (loteCurrent && loteCurrent.status_pagamento === novoStatus && novoStatus !== 'cancelado') {
        console.log('[EVENTOS WEBHOOK] Lote já está com status correto (idempotência):', loteId, novoStatus);
        console.timeEnd("ASAAS_WEBHOOK_TOTAL");
        return NextResponse.json({ received: true, action: 'already_processed', loteId });
      }

      const updateLote: Record<string, unknown> = { status_pagamento: novoStatus };
      if (novoStatus === 'pago') updateLote.comprovante_url = payment?.transactionReceiptUrl ?? null;

      const { error: loteErr } = await supabase
        .from('evento_lotes_inscricao')
        .update(updateLote)
        .eq('id', loteId);

      if (loteErr) {
        console.error('[EVENTOS WEBHOOK] Erro ao atualizar lote:', loteErr.message);
        console.timeEnd("ASAAS_WEBHOOK_TOTAL");
        return NextResponse.json({ error: loteErr.message }, { status: 500 });
      }
      // O trigger fn_sync_lote_pagamento cuida de atualizar as inscrições do lote de forma síncrona
      console.log('[EVENTOS WEBHOOK] Lote atualizado:', loteId, '→', novoStatus);

      // Enfileira jobs pós-baixa se pago
      if (novoStatus === 'pago') {
        const { data: loteIns } = await supabase
          .from('evento_inscricoes')
          .select('id')
          .eq('lote_id', loteId);

        if (loteIns && loteIns.length > 0) {
          const jobs = [];
          for (const li of loteIns) {
            jobs.push(
              { job_type: 'ALLOCATE_ACCOMMODATION', entity_type: 'inscricao', entity_id: li.id, external_event_id: eventId, external_payment_id: asaasId },
              { job_type: 'SEND_CONFIRMATION_EMAIL', entity_type: 'inscricao', entity_id: li.id, external_event_id: eventId, external_payment_id: asaasId },
              { job_type: 'REGISTER_MINISTERIAL_HISTORY', entity_type: 'inscricao', entity_id: li.id, external_event_id: eventId, external_payment_id: asaasId }
            );
          }
          try {
            await enqueueWebhookJobs(supabase, jobs);
            console.log(`[EVENTOS WEBHOOK] Enfileirados ${jobs.length} jobs para o lote ${loteId}`);
          } catch (jobErr: any) {
            console.error(`[EVENTOS WEBHOOK] ERRO CRÍTICO: Falha ao enfileirar jobs do lote ${loteId}:`, jobErr.message);
            void logDB({
              acao: 'erro_critico',
              modulo: 'eventos',
              entidade: 'webhook',
              descricao: `Falha ao enfileirar jobs do lote ${loteId}: ${jobErr.message}`,
              status: 'erro',
              detalhes: { event, eventId, asaasId, loteId }
            });
          }
        }
      }

      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      void logDB({
        acao: 'receber_webhook',
        modulo: 'eventos',
        entidade: 'webhook',
        descricao: `Webhook de Lote Pago recebido e processado com sucesso. Lote: ${loteId}`,
        status: 'sucesso',
        detalhes: { event, eventId, asaasId, loteId, durationMs: Date.now() - startTime }
      });
      return NextResponse.json({ received: true, loteId, status: novoStatus });
    }

    // 4b. Localiza inscrição individual pelo asaas_payment_id
    const { data: ins, error: findErr } = await supabase
      .from('evento_inscricoes')
      .select('id, status_pagamento, evento_id, ministro_id, cpf, tipo_inscricao')
      .eq('asaas_payment_id', asaasId)
      .maybeSingle();

    if (findErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao buscar inscrição:', findErr.message);
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }

    if (!ins) {
      // Pode ser cobrança de outro módulo (payments) — aceita sem erro
      console.log('[EVENTOS WEBHOOK] Inscrição não encontrada para o asaas_payment_id:', asaasId);
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ received: true, action: 'not_found_in_eventos' });
    }

    // 5. Idempotência rápida: não regride status (pago → pendente não acontece)
    if (ins.status_pagamento === 'pago' && novoStatus !== 'cancelado') {
      console.log('[EVENTOS WEBHOOK] Inscrição já está paga (idempotência):', ins.id);
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ received: true, action: 'already_paid', inscricaoId: ins.id });
    }

    if (ins.status_pagamento === novoStatus) {
      console.log('[EVENTOS WEBHOOK] Inscrição já está com status correto (idempotência):', ins.id, novoStatus);
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ received: true, action: 'already_processed', inscricaoId: ins.id });
    }

    // 6. Monta update
    const updateData: Record<string, unknown> = {
      status_pagamento: novoStatus,
    };

    if (novoStatus === 'pago') {
      updateData.valor_pago    = payment?.value ?? 0;
      updateData.comprovante_url = payment?.transactionReceiptUrl ?? null;
    }

    const { error: updErr } = await supabase
      .from('evento_inscricoes')
      .update(updateData)
      .eq('id', ins.id);

    if (updErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao atualizar inscrição:', updErr.message);
      console.timeEnd("ASAAS_WEBHOOK_TOTAL");
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    console.log('[EVENTOS WEBHOOK] Inscrição atualizada:', ins.id, '→', novoStatus);

    // Enfileira jobs pós-baixa se pago
    if (novoStatus === 'pago') {
      try {
        await enqueueWebhookJobs(supabase, [
          { job_type: 'ALLOCATE_ACCOMMODATION', entity_type: 'inscricao', entity_id: ins.id, external_event_id: eventId, external_payment_id: asaasId },
          { job_type: 'SEND_CONFIRMATION_EMAIL', entity_type: 'inscricao', entity_id: ins.id, external_event_id: eventId, external_payment_id: asaasId },
          { job_type: 'REGISTER_MINISTERIAL_HISTORY', entity_type: 'inscricao', entity_id: ins.id, external_event_id: eventId, external_payment_id: asaasId }
        ]);
        console.log(`[EVENTOS WEBHOOK] Enfileirados jobs pós-baixa para inscrição ${ins.id}`);
      } catch (jobErr: any) {
        console.error(`[EVENTOS WEBHOOK] ERRO CRÍTICO: Falha ao enfileirar jobs da inscrição ${ins.id}:`, jobErr.message);
        void logDB({
          acao: 'erro_critico',
          modulo: 'eventos',
          entidade: 'webhook',
          descricao: `Falha ao enfileirar jobs da inscrição ${ins.id}: ${jobErr.message}`,
          status: 'erro',
          detalhes: { event, eventId, asaasId, inscricaoId: ins.id }
        });
      }
    }

    console.timeEnd("ASAAS_WEBHOOK_TOTAL");
    void logDB({
      acao: 'receber_webhook',
      modulo: 'eventos',
      entidade: 'webhook',
      descricao: `Webhook de Inscrição Pago recebido e processado com sucesso. Inscrição: ${ins.id}`,
      status: 'sucesso',
      detalhes: { event, eventId, asaasId, inscricaoId: ins.id, durationMs: Date.now() - startTime }
    });
    return NextResponse.json({ received: true, inscricaoId: ins.id, status: novoStatus });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EVENTOS WEBHOOK] Erro inesperado:', msg);
    console.timeEnd("ASAAS_WEBHOOK_TOTAL");
    void logDB({
      acao: 'erro_critico',
      modulo: 'eventos',
      entidade: 'webhook',
      descricao: `Erro inesperado no webhook ASAAS: ${msg}`,
      status: 'erro',
      detalhes: { event, paymentId: asaasId, extRef },
      mensagemErro: msg,
    });
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
