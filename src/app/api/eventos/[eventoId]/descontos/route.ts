import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const operacaoId = searchParams.get('operacao_id');
    const solicitacaoId = searchParams.get('solicitacao_id');
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    const admin = guard.ctx.supabaseAdmin;
    let query = admin
      .from('evento_desconto_autorizacoes')
      .select('*')
      .eq('evento_id', eventoId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (operacaoId) {
      query = query.eq('operacao_id', operacaoId.trim());
    }
    if (solicitacaoId) {
      query = query.eq('id', solicitacaoId.trim());
    }
    if (status) {
      query = query.eq('status', status.trim());
    }

    const { data: lista, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Erro ao listar autorizações de desconto.', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, autorizacoes: lista || [] });
  } catch (err: any) {
    console.error('[DESCONTO LISTAR] Erro geral:', err);
    return NextResponse.json({ error: 'Falha interna ao listar autorizações de desconto.' }, { status: 500 });
  }
}
