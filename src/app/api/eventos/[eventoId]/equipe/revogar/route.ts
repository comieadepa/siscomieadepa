import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

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
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('evento_equipe')
    .update({
      ativo: false,
      atualizado_em: now,
    })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  if (error) {
    return NextResponse.json({ error: 'Erro ao revogar acesso.' }, { status: 500 });
  }

  void logDB({
    acao: 'desativar_membro_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Membro de equipe desativado pelo painel (rota revogar).',
    status: 'sucesso',
    detalhes: { eventoId, equipeId },
    request,
  });

  return NextResponse.json({ ok: true });
}
