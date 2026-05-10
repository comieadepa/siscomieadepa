import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getAsaasPayment, getAsaasPixQrCode } from '@/lib/asaas';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ inscricaoId: string }> }
) {
  const { inscricaoId } = await params;

  if (!inscricaoId) {
    return NextResponse.json({ error: 'inscricaoId ausente' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: ins, error } = await supabase
    .from('evento_inscricoes')
    .select('id, status_pagamento, asaas_payment_id, valor_pago')
    .eq('id', inscricaoId)
    .single();

  if (error || !ins) {
    return NextResponse.json({ error: 'Inscrição não encontrada' }, { status: 404 });
  }

  // Se já está pago ou isento, retorna direto sem chamar ASAAS
  if (ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento') {
    return NextResponse.json({
      status: ins.status_pagamento,
      pixQrCode: null,
      pixCopiaECola: null,
      invoiceUrl: null,
    });
  }

  // Se não tem ID ASAAS, não há cobrança criada
  if (!ins.asaas_payment_id) {
    return NextResponse.json({
      status: ins.status_pagamento,
      pixQrCode: null,
      pixCopiaECola: null,
      invoiceUrl: null,
    });
  }

  try {
    const [payment, pix] = await Promise.all([
      getAsaasPayment(ins.asaas_payment_id),
      getAsaasPixQrCode(ins.asaas_payment_id),
    ]);

    // Sincroniza status se ASAAS já confirmou
    const statusMap: Record<string, string> = {
      CONFIRMED: 'pago',
      RECEIVED:  'pago',
      RECEIVED_IN_CASH: 'pago',
    };
    const asaasStatus = String(payment?.status ?? '').toUpperCase();
    const novoStatus  = statusMap[asaasStatus];

    if (novoStatus && ins.status_pagamento !== novoStatus) {
      await supabase
        .from('evento_inscricoes')
        .update({
          status_pagamento: novoStatus,
          valor_pago: payment.value ?? ins.valor_pago,
        })
        .eq('id', inscricaoId);
    }

    return NextResponse.json({
      status:        novoStatus ?? ins.status_pagamento,
      pixQrCode:     pix.encodedImage,
      pixCopiaECola: pix.payload,
      invoiceUrl:    payment?.invoiceUrl ?? null,
    });
  } catch (err) {
    console.error('[PAGAMENTO CHECK] Erro ao consultar ASAAS:', (err as Error).message);
    return NextResponse.json({
      status: ins.status_pagamento,
      pixQrCode: null,
      pixCopiaECola: null,
      invoiceUrl: null,
    });
  }
}
