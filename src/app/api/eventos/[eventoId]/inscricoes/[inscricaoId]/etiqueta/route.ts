import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; inscricaoId: string }> }
) {
  const { eventoId, inscricaoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarInscricoes) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { data: ins, error } = await supabase
    .from('evento_inscricoes')
    .select('id, etiqueta_impressa')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  if (error || !ins) {
    return NextResponse.json({ error: 'Inscricao nao encontrada.' }, { status: 404 });
  }

  const novoValor = !ins.etiqueta_impressa;
  const { error: updErr } = await supabase
    .from('evento_inscricoes')
    .update({ etiqueta_impressa: novoValor })
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ etiqueta_impressa: novoValor });
}
