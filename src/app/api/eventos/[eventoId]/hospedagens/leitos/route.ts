import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

/**
 * GET /api/eventos/[eventoId]/hospedagens/leitos
 * Lista todos os leitos do evento com alojamento e inscrito.
 *
 * DELETE /api/eventos/[eventoId]/hospedagens/leitos
 * Libera um leito: ocupado=false, inscricao_id=null.
 * Body: { id: string }
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeHospedagem) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('evento_hospedagem_leitos')
    .select(`
      id, numero, tipo_leito, posicao, ocupado, created_at,
      alojamento_id,
      evento_alojamentos ( nome, publico ),
      inscricao_id,
      evento_inscricoes ( nome_inscrito, cpf )
    `)
    .eq('evento_id', eventoId)
    .order('alojamento_id', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leitos: data ?? [] });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeHospedagem) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const { id } = body as { id?: string };
  if (!id) return NextResponse.json({ error: 'ID do leito obrigatório.' }, { status: 400 });

  const { error } = await supabase
    .from('evento_hospedagem_leitos')
    .update({ ocupado: false, inscricao_id: null })
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
