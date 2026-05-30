/**
 * PATCH /api/secretaria/impressoes-credenciais/[id]
 * Atualiza o status de uma solicitação de impressão.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

const ALLOWED_ROLES = ['super', 'administrador', 'cgadb'] as const;

const TRANSITIONS: Record<string, string[]> = {
  pago_pendente_impressao: ['em_impressao', 'cancelado'],
  em_impressao: ['impresso', 'cancelado'],
  impresso: ['entregue'],
  entregue: [],
  cancelado: [],
  aguardando_pagamento: ['cancelado'],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });

  const body = await request.json();
  const novoStatus = String(body?.status || '');

  if (!novoStatus) {
    return NextResponse.json({ error: 'status é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: atual, error: fetchErr } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .select('id, status, ministro_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !atual) {
    return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 });
  }

  const permitidos = TRANSITIONS[atual.status] || [];
  if (!permitidos.includes(novoStatus)) {
    return NextResponse.json(
      { error: `Transição inválida: ${atual.status} → ${novoStatus}` },
      { status: 422 },
    );
  }

  const updateData: Record<string, any> = {
    status: novoStatus,
    updated_at: new Date().toISOString(),
  };

  if (novoStatus === 'em_impressao') updateData.em_impressao_em = new Date().toISOString();
  if (novoStatus === 'impresso') updateData.impresso_em = new Date().toISOString();
  if (novoStatus === 'entregue') updateData.entregue_em = new Date().toISOString();
  if (novoStatus === 'cancelado') updateData.cancelado_em = new Date().toISOString();

  const { error: updErr } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .update(updateData)
    .eq('id', id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  void logDB({
    acao: 'editar',
    modulo: 'secretaria',
    entidade: 'credencial_impressao',
    entidadeId: id,
    descricao: `Status atualizado: ${atual.status} → ${novoStatus}`,
    status: 'sucesso',
    detalhes: { ministroId: atual.ministro_id, novoStatus },
  });

  return NextResponse.json({ ok: true, status: novoStatus });
}
