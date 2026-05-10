import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

function resolveToken(request: NextRequest): string | null {
  const direct = request.headers.get('asaas-access-token') || request.headers.get('access_token');
  if (direct) return direct;
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  return auth.replace('Bearer ', '');
}

export async function POST(request: NextRequest) {
  try {
    // 1. Valida token
    if (!ASAAS_WEBHOOK_TOKEN) {
      console.error('[EVENTOS WEBHOOK] ASAAS_WEBHOOK_TOKEN não configurado');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = resolveToken(request);
    if (!token || token !== ASAAS_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Lê payload
    const payload = await request.json();
    const event   = String(payload?.event || '').toUpperCase();
    const payment = payload?.payment;
    const asaasId = payment?.id;

    if (!asaasId) {
      return NextResponse.json({ error: 'Payment ID ausente' }, { status: 400 });
    }

    console.log('[EVENTOS WEBHOOK] Evento recebido:', event, asaasId);

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
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    const supabase = createServerClient();

    // 4. Verifica se é cobrança de lote (externalReference inicia com "lote:")
    const extRef = String(payment?.externalReference ?? '');
    if (extRef.startsWith('lote:')) {
      const loteId = extRef.slice(5);
      const updateLote: Record<string, unknown> = { status_pagamento: novoStatus };
      if (novoStatus === 'pago') updateLote.comprovante_url = payment.transactionReceiptUrl ?? null;

      const { error: loteErr } = await supabase
        .from('evento_lotes_inscricao')
        .update(updateLote)
        .eq('id', loteId);

      if (loteErr) {
        console.error('[EVENTOS WEBHOOK] Erro ao atualizar lote:', loteErr.message);
        return NextResponse.json({ error: loteErr.message }, { status: 500 });
      }
      // O trigger fn_sync_lote_pagamento cuida de atualizar as inscrições do lote
      console.log('[EVENTOS WEBHOOK] Lote atualizado:', loteId, '→', novoStatus);
      return NextResponse.json({ received: true, loteId, status: novoStatus });
    }

    // 4b. Localiza inscrição individual pelo asaas_payment_id
    const { data: ins, error: findErr } = await supabase
      .from('evento_inscricoes')
      .select('id, status_pagamento')
      .eq('asaas_payment_id', asaasId)
      .maybeSingle();

    if (findErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao buscar inscrição:', findErr.message);
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }

    if (!ins) {
      // Pode ser cobrança de outro módulo (payments) — aceita sem erro
      return NextResponse.json({ received: true, action: 'not_found_in_eventos' });
    }

    // 5. Não regride status (pago → pendente não acontece)
    if (ins.status_pagamento === 'pago' && novoStatus !== 'cancelado') {
      return NextResponse.json({ received: true, action: 'already_paid' });
    }

    // 6. Monta update
    const updateData: Record<string, unknown> = {
      status_pagamento: novoStatus,
    };

    if (novoStatus === 'pago') {
      updateData.valor_pago    = payment.value ?? 0;
      updateData.comprovante_url = payment.transactionReceiptUrl ?? null;
    }

    const { error: updErr } = await supabase
      .from('evento_inscricoes')
      .update(updateData)
      .eq('id', ins.id);

    if (updErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao atualizar inscrição:', updErr.message);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    console.log('[EVENTOS WEBHOOK] Inscrição atualizada:', ins.id, '→', novoStatus);
    return NextResponse.json({ received: true, inscricaoId: ins.id, status: novoStatus });

  } catch (err: any) {
    console.error('[EVENTOS WEBHOOK] Erro inesperado:', err.message);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
