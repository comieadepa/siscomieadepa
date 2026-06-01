import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// ── Helper de auth ──────────────────────────────────────────────
async function requireAuth(request: NextRequest, eventoId: string) {
  return requireEventoPermission(request, eventoId, 'certificados');
}

// PATCH /api/eventos/[eventoId]/certificados/[inscricaoId]
// Marca certificado como enviado/gerado
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireAuth(_req, eventoId);
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // Valida que a inscrição pertence ao evento e é elegível
  const { data: inscricao, error: fetchError } = await supabase
    .from('evento_inscricoes')
    .select('id, status_pagamento, checkin_realizado')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  if (fetchError || !inscricao) {
    return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });
  }

  // Segurança: só elegíveis recebem marcação
  if (!['pago', 'isento'].includes(inscricao.status_pagamento)) {
    return NextResponse.json({ error: 'Inscrição não está paga ou isenta.' }, { status: 400 });
  }
  if (!inscricao.checkin_realizado) {
    return NextResponse.json({ error: 'Check-in não realizado.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('evento_inscricoes')
    .update({ certificado_enviado: true })
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — desfaz a marcação (admin)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireAuth(_req, eventoId);
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_inscricoes')
    .update({ certificado_enviado: false })
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
