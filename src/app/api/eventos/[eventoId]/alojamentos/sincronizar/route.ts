import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { materializarSetoresHospedagemAGO } from '@/lib/materializar-setores';

/**
 * POST /api/eventos/[eventoId]/alojamentos/sincronizar
 *
 * Materializa setores planejados (configuracoes_ago.setores) em evento_alojamentos.
 * Idempotente: pode ser chamado múltiplas vezes sem duplicar registros.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  const resultado = await materializarSetoresHospedagemAGO(guard.ctx.supabaseAdmin, eventoId);

  if (resultado.erro) {
    return NextResponse.json({ error: resultado.erro }, { status: 500 });
  }

  return NextResponse.json({
    sincronizados: resultado.criados + resultado.atualizados,
    criados:       resultado.criados,
    atualizados:   resultado.atualizados,
  });
}
