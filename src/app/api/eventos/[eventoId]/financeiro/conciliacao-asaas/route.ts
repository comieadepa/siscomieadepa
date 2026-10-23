import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import {
  previewConciliacaoEvento,
  regularizarPagamentosConfirmados,
} from '@/lib/eventos/conciliacao-asaas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventos/[eventoId]/financeiro/conciliacao-asaas
 * Consulta prévia de conciliação Asaas sem modificar nenhum dado.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // 1. Autorização: restrito a usuários com permissão na área 'financeiro' do evento
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;

  try {
    const supabaseAdmin = guard.ctx.supabaseAdmin;
    const preview = await previewConciliacaoEvento(supabaseAdmin, eventoId);

    return NextResponse.json(preview);
  } catch (err: any) {
    console.error('[API CONCILIACAO ASAAS - GET] Erro:', err.message);
    return NextResponse.json(
      { error: err?.message || 'Falha ao consultar cobranças no Asaas para conciliação.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/eventos/[eventoId]/financeiro/conciliacao-asaas
 * Executa a regularização dos pagamentos confirmados em lote.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // 1. Autorização: restrito a administradores com permissão de edição financeira no evento
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;

  if (!guard.ctx.perms.podeEditarEvento) {
    return NextResponse.json(
      { error: 'Apenas administradores financeiros podem regularizar pagamentos em lote.' },
      { status: 403 }
    );
  }

  try {
    const supabaseAdmin = guard.ctx.supabaseAdmin;
    const operador = {
      id: guard.ctx.user?.id || 'sistema',
      email: guard.ctx.user?.email || 'admin@sistema',
    };

    const resultado = await regularizarPagamentosConfirmados(supabaseAdmin, eventoId, operador);

    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error('[API CONCILIACAO ASAAS - POST] Erro:', err.message);
    return NextResponse.json(
      { error: err?.message || 'Falha ao regularizar pagamentos do Asaas.' },
      { status: 500 }
    );
  }
}
