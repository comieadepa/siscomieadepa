/**
 * PATCH /api/secretaria/impressoes-credenciais/[id]
 * Atualiza o status de uma solicitação de impressão.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';
import { criarNotificacaoMinistro } from '@/lib/notificacoes-ministro';

const ALLOWED_ROLES = ['super', 'administrador', 'cgadb'] as const;

const TRANSITIONS: Record<string, string[]> = {
  pago_pendente_impressao: ['em_impressao', 'cancelado'],
  em_impressao: ['impresso', 'disponivel_retirada', 'cancelado'],
  impresso: ['disponivel_retirada', 'entregue'],
  disponivel_retirada: ['entregue', 'cancelado'],
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
  if (novoStatus === 'impresso' || novoStatus === 'disponivel_retirada') {
    updateData.disponivel_retirada_em = new Date().toISOString();
    updateData.impresso_em = new Date().toISOString();
  }
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

  // 1. Dispara notificação in-app quando enviado para produção
  if (novoStatus === 'em_impressao' && atual.status !== 'em_impressao' && atual.ministro_id) {
    try {
      await criarNotificacaoMinistro({
        ministroId: atual.ministro_id,
        tipo: 'credencial',
        titulo: 'Credencial em Produção',
        mensagem: 'Sua credencial física está em produção. Você será avisado quando estiver disponível para retirada na Secretaria Geral da COMIEADEPA.',
        linkAcao: '/portal-ministro/credencial',
        canal: 'in_app',
      });
    } catch (notifErr: any) {
      console.error('[secretaria/impressoes-credenciais] Erro ao disparar notificação em_impressao:', notifErr?.message);
    }
  }

  // 2. Dispara notificação (In-App + E-mail via Resend) quando pronta para retirada
  const isProntaRetirada = novoStatus === 'disponivel_retirada' || novoStatus === 'impresso';
  const estavaProntaRetirada = atual.status === 'disponivel_retirada' || atual.status === 'impresso';

  if (isProntaRetirada && !estavaProntaRetirada && atual.ministro_id) {
    try {
      await criarNotificacaoMinistro({
        ministroId: atual.ministro_id,
        tipo: 'credencial',
        titulo: 'Sua Credencial Está Pronta!',
        mensagem: 'Sua credencial física foi impressa e está disponível para retirada na Secretaria Geral da COMIEADEPA. Acesse a Central de Credencial para acompanhar os detalhes.',
        linkAcao: '/portal-ministro/credencial',
        canal: 'ambos',
      });
    } catch (notifErr: any) {
      console.error('[secretaria/impressoes-credenciais] Erro ao disparar notificação disponivel_retirada:', notifErr?.message);
    }
  }

  // 3. Dispara notificação in-app quando a credencial é entregue
  if (novoStatus === 'entregue' && atual.status !== 'entregue' && atual.ministro_id) {
    try {
      await criarNotificacaoMinistro({
        ministroId: atual.ministro_id,
        tipo: 'credencial',
        titulo: 'Credencial Entregue',
        mensagem: 'Sua credencial física foi entregue com sucesso. A Central de Credencial permanece disponível para consultar os dados e a validade do seu documento.',
        linkAcao: '/portal-ministro/credencial',
        canal: 'in_app',
      });
    } catch (notifErr: any) {
      console.error('[secretaria/impressoes-credenciais] Erro ao disparar notificação entregue:', notifErr?.message);
    }
  }

  return NextResponse.json({ ok: true, status: novoStatus });
}
