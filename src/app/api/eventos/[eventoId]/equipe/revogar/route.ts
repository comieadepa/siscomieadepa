import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeCriarEquipe) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: { equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  if (!equipeId) {
    return NextResponse.json({ error: 'equipe_id obrigatorio.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_equipe')
    .update({
      ativo: false,
      convite_token: null,
      convite_expira_em: null,
    })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  if (error) {
    return NextResponse.json({ error: 'Erro ao revogar acesso.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
