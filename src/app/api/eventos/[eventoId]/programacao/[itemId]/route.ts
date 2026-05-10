import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

// ── Helper de auth ──────────────────────────────────────────────
async function requireAuth() {
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  return user;
}

// PATCH /api/eventos/[eventoId]/programacao/[itemId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; itemId: string }> }
) {
  const { eventoId, itemId } = await params;
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

  const body = await req.json();
  const { data: dataEvento, horario, titulo, descricao, palestrante, local, ordem } = body;

  if (!titulo) {
    return NextResponse.json({ error: 'Título é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient();
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
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from('evento_programacao')
    .delete()
    .eq('id', itemId)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
