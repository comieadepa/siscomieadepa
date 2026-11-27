import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { solicitacao_id, motivo } = body;

    if (!solicitacao_id || typeof solicitacao_id !== 'string') {
      return NextResponse.json({ error: 'ID da solicitação é obrigatório.' }, { status: 400 });
    }

    const admin = guard.ctx.supabaseAdmin;

    const { data: cancelada, error } = await admin
      .from('evento_desconto_autorizacoes')
      .update({
        status: 'cancelado',
        justificativa_supervisor: motivo ? `Cancelado pelo operador: ${motivo}` : 'Cancelado pelo operador.',
        deliberado_em: new Date().toISOString(),
      })
      .eq('id', solicitacao_id)
      .eq('evento_id', eventoId)
      .in('status', ['pendente', 'autorizado'])
      .eq('utilizado', false)
      .select('*')
      .single();

    if (error || !cancelada) {
      return NextResponse.json({
        error: 'Não foi possível cancelar esta solicitação. Ela pode já ter sido utilizada ou cancelada.'
      }, { status: 400 });
    }

    void logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email || undefined,
      acao: 'cancelar_solicitacao_desconto_balcao',
      modulo: 'eventos',
      entidade: 'evento_desconto_autorizacoes',
      entidadeId: solicitacao_id,
      descricao: `Solicitação de desconto cancelada pelo operador.`,
      status: 'sucesso',
      detalhes: { evento_id: eventoId, solicitacao_id, motivo },
      request,
    });

    return NextResponse.json({ success: true, solicitacao: cancelada });
  } catch (err: any) {
    console.error('[DESCONTO CANCELAR] Erro geral:', err);
    return NextResponse.json({ error: 'Falha interna ao cancelar solicitação de desconto.' }, { status: 500 });
  }
}
