import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

// ── Helper de auth ──────────────────────────────────────────────
async function requireAuth(request: NextRequest, eventoId: string) {
  return requireEventoAccess(request, eventoId);
}

// PATCH /api/eventos/[eventoId]/programacao/[itemId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; itemId: string }> }
) {
  const { eventoId, itemId } = await params;
  const guard = await requireAuth(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeProgramacao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const body = await req.json();
  const { data: dataEvento, horario, titulo, descricao, palestrante, local, ordem } = body;

  if (!titulo) {
    return NextResponse.json({ error: 'Título é obrigatório.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { data, error } = await supabase
    .from('evento_programacao')
    .update({
      data:        dataEvento || undefined,
      horario:     horario || null,
      titulo:      String(titulo).trim(),
      descricao:   descricao ? String(descricao).trim() : null,
      palestrante: palestrante ? String(palestrante).trim() : null,
      local:       local ? String(local).trim() : null,
      ordem:       Number(ordem) || 0,
    })
    .eq('id', itemId)
    .eq('evento_id', eventoId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

// DELETE /api/eventos/[eventoId]/programacao/[itemId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; itemId: string }> }
) {
  const { eventoId, itemId } = await params;
  const guard = await requireAuth(_req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeProgramacao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_programacao')
    .delete()
    .eq('id', itemId)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
