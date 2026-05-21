import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// POST /api/eventos/[eventoId]/deliberacoes/[deliberacaoId]/aprovar
// Transição: rascunho → aprovado
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; deliberacaoId: string }> }
) {
  const { eventoId, deliberacaoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento)
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const supabase  = guard.ctx.supabaseAdmin;
  const userId    = guard.ctx.user.id;
  const userMeta  = guard.ctx.user.user_metadata as Record<string, unknown>;
  const userName  = (userMeta?.nome as string | undefined) || (guard.ctx.user.email ?? 'Admin');

  const { data: existing } = await supabase
    .from('evento_ago_deliberacoes')
    .select('*')
    .eq('id', deliberacaoId)
    .eq('evento_id', eventoId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Deliberação não encontrada.' }, { status: 404 });
  if (existing.status !== 'rascunho')
    return NextResponse.json({ error: 'Apenas rascunhos podem ser aprovados.' }, { status: 400 });

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('evento_ago_deliberacoes')
    .update({
      status:           'aprovado',
      aprovado_em:      now,
      aprovado_por_id:  userId,
      aprovado_por_nome: userName,
      updated_at:       now,
    })
    .eq('id', deliberacaoId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logDB({
    userId,
    acao: 'aprovar_deliberacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_deliberacoes',
    entidadeId: deliberacaoId,
    status: 'sucesso',
    descricao: `Deliberação aprovada: ${existing.tipo} — ${existing.ministro_nome}.`,
    request,
  });

  return NextResponse.json({ ok: true, record: updated });
}
