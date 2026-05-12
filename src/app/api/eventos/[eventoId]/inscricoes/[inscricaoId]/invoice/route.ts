import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarInscricoes && !guard.ctx.perms.podeComunicacao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

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
