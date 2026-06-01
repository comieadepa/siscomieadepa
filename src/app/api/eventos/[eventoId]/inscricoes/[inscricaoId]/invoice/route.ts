import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { createEventoPayment, createOrFindAsaasCustomer } from '@/lib/asaas';
import { cleanCpf, isValidCpf } from '@/lib/cpf';

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const { data: ins, error } = await supabase
    .from('evento_inscricoes')
    .select('id, status_pagamento, invoice_url, asaas_payment_id')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  if (error || !ins) {
    return NextResponse.json({ error: 'Inscricao nao encontrada.' }, { status: 404 });
  }

  if (ins.status_pagamento !== 'pendente') {
    return NextResponse.json({ error: 'Pagamento ja confirmado.' }, { status: 422 });
  }

  if (!ins.invoice_url || !ins.asaas_payment_id) {
    return NextResponse.json({ error: 'Sem cobranca ASAAS.' }, { status: 422 });
  }

  return NextResponse.json({ invoice_url: ins.invoice_url });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  const { data: ins, error } = await supabase
    .from('evento_inscricoes')
    .select('id, lote_id, nome_inscrito, cpf, email, whatsapp, status_pagamento, invoice_url, asaas_payment_id, valor_final, tipo_inscricao')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  if (error || !ins) {
    return NextResponse.json({ error: 'Inscricao nao encontrada.' }, { status: 404 });
  }

  if (ins.status_pagamento !== 'pendente') {
    return NextResponse.json({ error: 'Pagamento ja confirmado.' }, { status: 422 });
  }

  if (ins.invoice_url && ins.asaas_payment_id) {
    return NextResponse.json({ invoice_url: ins.invoice_url });
  }

  if (!isValidCpf(ins.cpf)) {
    return NextResponse.json({
      error: 'CPF invalido. Corrija o CPF antes de gerar a cobranca ASAAS.',
    }, { status: 422 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  try {
    const dueDate = dueDateFromNow();

    if (ins.lote_id) {
      const { data: lote } = await supabase
        .from('evento_lotes_inscricao')
        .select('id, codigo, responsavel_nome, responsavel_email, responsavel_whatsapp, valor_total, status_pagamento, invoice_url, asaas_payment_id')
        .eq('id', ins.lote_id)
        .eq('evento_id', eventoId)
        .single();

      if (!lote) {
        return NextResponse.json({ error: 'Lote nao encontrado.' }, { status: 404 });
      }
      if (lote.status_pagamento !== 'pendente') {
        return NextResponse.json({ error: 'Pagamento do lote ja confirmado.' }, { status: 422 });
      }
      if (lote.invoice_url && lote.asaas_payment_id) {
        return NextResponse.json({ invoice_url: lote.invoice_url });
      }

      const customerId = await createOrFindAsaasCustomer({
        nome: lote.responsavel_nome || ins.nome_inscrito,
        email: lote.responsavel_email || ins.email || null,
        cpf: cleanCpf(ins.cpf),
        whatsapp: lote.responsavel_whatsapp || ins.whatsapp || null,
      });
      const pagamento = await createEventoPayment({
        customerId,
        value: Number(lote.valor_total ?? ins.valor_final ?? 0),
        dueDate,
        description: `Lote ${lote.codigo} - ${evento.nome}`,
        externalReference: `lote:${lote.id}`,
      });

      await supabase
        .from('evento_lotes_inscricao')
        .update({
          asaas_payment_id: pagamento.id,
          invoice_url: pagamento.invoiceUrl,
          pix_copia_cola: pagamento.pixCopiaECola,
          pix_qr_code: pagamento.pixQrCode,
          asaas_due_date: dueDate,
        })
        .eq('id', lote.id);

      return NextResponse.json({ invoice_url: pagamento.invoiceUrl });
    }

    const customerId = await createOrFindAsaasCustomer({
      nome: ins.nome_inscrito,
      email: ins.email || null,
      cpf: cleanCpf(ins.cpf),
      whatsapp: ins.whatsapp || null,
    });
    const pagamento = await createEventoPayment({
      customerId,
      value: Number(ins.valor_final ?? 0),
      dueDate,
      description: `Inscricao - ${evento.nome}${ins.tipo_inscricao ? ` (${ins.tipo_inscricao})` : ''}`,
      externalReference: ins.id,
    });

    await supabase
      .from('evento_inscricoes')
      .update({
        asaas_payment_id: pagamento.id,
        forma_pagamento: 'pix',
        invoice_url: pagamento.invoiceUrl,
        pix_copia_cola: pagamento.pixCopiaECola,
        pix_qr_code: pagamento.pixQrCode,
        asaas_due_date: dueDate,
      })
      .eq('id', ins.id);

    return NextResponse.json({ invoice_url: pagamento.invoiceUrl });
  } catch (err) {
    console.error('[EVENTO INVOICE] Erro ao gerar cobranca ASAAS:', {
      eventoId,
      inscricaoId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Nao foi possivel gerar a cobranca ASAAS.' }, { status: 502 });
  }
}
