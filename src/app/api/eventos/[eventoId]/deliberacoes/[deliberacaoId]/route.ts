import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { normalizePayloadUppercase } from '@/lib/text';

export const dynamic = 'force-dynamic';

const TIPOS_VALIDOS = [
  'consagracao', 'ordenacao', 'separacao_ministerio', 'recebimento',
  'transferencia', 'jubilacao', 'mudanca_cargo', 'aprovacao_candidato',
  'exclusao', 'observacao_geral',
] as const;

// PATCH /api/eventos/[eventoId]/deliberacoes/[deliberacaoId]
// Edita campos de uma deliberação (apenas em rascunho)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; deliberacaoId: string }> }
) {
  const { eventoId, deliberacaoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento)
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const supabase = guard.ctx.supabaseAdmin;

  // Verifica que existe e está em rascunho
  const { data: existing } = await supabase
    .from('evento_ago_deliberacoes')
    .select('id, status')
    .eq('id', deliberacaoId)
    .eq('evento_id', eventoId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Deliberação não encontrada.' }, { status: 404 });
  if (existing.status !== 'rascunho')
    return NextResponse.json({ error: 'Apenas deliberações em rascunho podem ser editadas.' }, { status: 400 });

  const raw = await request.json() as Record<string, unknown>;
  const {
    ministro_id,
    ministro_nome,
    ministro_matricula,
    ministro_campo,
    ministro_supervisao,
    tipo,
    data_deliberacao,
    situacao_anterior,
    situacao_nova,
    observacao,
    numero_ata,
  } = raw;

  if (tipo && !TIPOS_VALIDOS.includes(tipo as typeof TIPOS_VALIDOS[number]))
    return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });

  const normalized = normalizePayloadUppercase({
    ministro_nome:       ministro_nome       ? String(ministro_nome).trim()       : undefined,
    ministro_campo:      ministro_campo      ? String(ministro_campo).trim()      : undefined,
    ministro_supervisao: ministro_supervisao ? String(ministro_supervisao).trim() : undefined,
    situacao_anterior:   situacao_anterior   ? String(situacao_anterior).trim()   : undefined,
    situacao_nova:       situacao_nova       ? String(situacao_nova).trim()       : undefined,
  });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ministro_id         !== undefined) updates.ministro_id         = ministro_id ? String(ministro_id) : null;
  if (normalized.ministro_nome)         updates.ministro_nome        = normalized.ministro_nome;
  if (ministro_matricula  !== undefined) updates.ministro_matricula   = ministro_matricula ? String(ministro_matricula).trim() : null;
  if (normalized.ministro_campo   !== undefined) updates.ministro_campo      = normalized.ministro_campo ?? null;
  if (normalized.ministro_supervisao !== undefined) updates.ministro_supervisao = normalized.ministro_supervisao ?? null;
  if (tipo                !== undefined) updates.tipo                  = tipo;
  if (data_deliberacao    !== undefined) updates.data_deliberacao      = data_deliberacao ? String(data_deliberacao) : null;
  if (normalized.situacao_anterior !== undefined) updates.situacao_anterior   = normalized.situacao_anterior ?? null;
  if (normalized.situacao_nova     !== undefined) updates.situacao_nova       = normalized.situacao_nova ?? null;
  if (observacao          !== undefined) updates.observacao            = observacao ? String(observacao).trim() : null;
  if (numero_ata          !== undefined) updates.numero_ata            = numero_ata ? String(numero_ata).trim() : null;

  const { data: updated, error } = await supabase
    .from('evento_ago_deliberacoes')
    .update(updates)
    .eq('id', deliberacaoId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, record: updated });
}

// DELETE /api/eventos/[eventoId]/deliberacoes/[deliberacaoId]
// Remove deliberação (apenas rascunho)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; deliberacaoId: string }> }
) {
  const { eventoId, deliberacaoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento)
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const supabase = guard.ctx.supabaseAdmin;
  const userId   = guard.ctx.user.id;

  const { data: existing } = await supabase
    .from('evento_ago_deliberacoes')
    .select('id, status, ministro_nome, tipo')
    .eq('id', deliberacaoId)
    .eq('evento_id', eventoId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Deliberação não encontrada.' }, { status: 404 });
  if (existing.status !== 'rascunho')
    return NextResponse.json({ error: 'Apenas rascunhos podem ser removidos.' }, { status: 400 });

  const { error } = await supabase
    .from('evento_ago_deliberacoes')
    .delete()
    .eq('id', deliberacaoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logDB({
    userId,
    acao: 'excluir_deliberacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_deliberacoes',
    entidadeId: deliberacaoId,
    status: 'sucesso',
    descricao: `Deliberação ${existing.tipo} excluída: ${existing.ministro_nome}.`,
    request,
  });

  return NextResponse.json({ ok: true });
}
