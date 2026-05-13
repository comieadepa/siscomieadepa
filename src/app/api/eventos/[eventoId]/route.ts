import { NextRequest, NextResponse } from 'next/server';
import { requireEventAccess } from '@/lib/auth/require-auth';
import { registrarAuditoria } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Evento invalido.' }, { status: 400 });
  }

  const guard = await requireEventAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { error: inscError } = await supabase
    .from('evento_inscricoes')
    .delete()
    .eq('evento_id', eventoId);
  if (inscError) {
    return NextResponse.json({ error: inscError.message }, { status: 500 });
  }

  const { error: eventoError } = await supabase
    .from('eventos')
    .delete()
    .eq('id', eventoId);
  if (eventoError) {
    return NextResponse.json({ error: eventoError.message }, { status: 500 });
  }

  void registrarAuditoria(
    { userId: guard.ctx.user.id, userEmail: guard.ctx.user.email ?? undefined, acao: 'deletar', modulo: 'eventos', entidadeId: eventoId, descricao: 'Evento excluído' },
    request,
  );
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Evento invalido.' }, { status: 400 });
  }

  const guard = await requireEventAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { error: eventoError } = await supabase
    .from('eventos')
    .update({ status: 'cancelado', inscricoes_abertas: false })
    .eq('id', eventoId);
  if (eventoError) {
    return NextResponse.json({ error: eventoError.message }, { status: 500 });
  }

  const { error: inscError } = await supabase
    .from('evento_inscricoes')
    .update({ status_pagamento: 'cancelado' })
    .eq('evento_id', eventoId);
  if (inscError) {
    return NextResponse.json({ error: inscError.message }, { status: 500 });
  }

  void registrarAuditoria(
    { userId: guard.ctx.user.id, userEmail: guard.ctx.user.email ?? undefined, acao: 'editar', modulo: 'eventos', entidadeId: eventoId, descricao: 'Evento cancelado' },
    request,
  );
  return NextResponse.json({ success: true });
}
