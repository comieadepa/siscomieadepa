import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type HomologacaoStatus = 'pendente_analise' | 'regular' | 'ausente' | 'ausencia_justificada' | 'dispensado';

const VALID_STATUS: HomologacaoStatus[] = [
  'pendente_analise', 'regular', 'ausente', 'ausencia_justificada', 'dispensado',
];

// PATCH /api/eventos/[eventoId]/homologacao/[homologacaoId]
// Body: { status, motivo_justificativa?, observacao_justificativa? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; homologacaoId: string }> }
) {
  const { eventoId, homologacaoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'centro_controle');
  if (!guard.ok) return guard.response;

  const supabase  = guard.ctx.supabaseAdmin;
  const userId    = guard.ctx.user?.id;
  const userMeta  = (guard.ctx.user?.user_metadata ?? {}) as Record<string, unknown>;
  const userName  = (userMeta?.nome as string | undefined) || (guard.ctx.user?.email ?? 'Admin');

  const body = (await request.json()) as {
    status?: string;
    motivo_justificativa?: string;
    observacao_justificativa?: string;
  };

  const { status, motivo_justificativa, observacao_justificativa } = body;

  if (!status || !VALID_STATUS.includes(status as HomologacaoStatus))
    return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });

  if (
    (status === 'ausencia_justificada' || status === 'dispensado') &&
    !motivo_justificativa?.trim()
  ) {
    return NextResponse.json({ error: 'Motivo é obrigatório para este status.' }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from('evento_ago_homologacao')
    .update({
      status,
      motivo_justificativa:     motivo_justificativa?.trim() || null,
      observacao_justificativa: observacao_justificativa?.trim() || null,
      usuario_responsavel_id:   userId,
      usuario_responsavel_nome: userName,
      homologado_em:            now,
      updated_at:               now,
      // Se voltou para pendente, limpa histórico_registrado para permitir re-registro futuro
      historico_registrado:     status === 'pendente_analise' ? false : undefined,
    })
    .eq('id', homologacaoId)
    .eq('evento_id', eventoId)
    .select()
    .single();

  if (error || !updated)
    return NextResponse.json({ error: error?.message ?? 'Registro não encontrado.' }, { status: error ? 500 : 404 });

  void logDB({
    userId,
    acao: 'homologar_frequencia_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_homologacao',
    entidadeId: homologacaoId,
    status: 'sucesso',
    descricao: `Homologação: ${updated.nome} → ${status}${motivo_justificativa ? ` (${motivo_justificativa})` : ''}`,
    request,
  });

  return NextResponse.json({ ok: true, record: updated });
}
