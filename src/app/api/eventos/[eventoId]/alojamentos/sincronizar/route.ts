import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { materializarSetoresHospedagemAGO, salvarConfiguracoesAGOAtomica } from '@/lib/materializar-setores';

/**
 * POST /api/eventos/[eventoId]/alojamentos/sincronizar
 *
 * Sincroniza setores planejados com evento_alojamentos de forma atômica.
 * Se enviado "nova_configuracao_ago" no body, valida capacidade e persiste
 * atomicamente tanto configuracoes_ago quanto evento_alojamentos.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  // 1. Tentar ler body caso enviado
  let novaConfiguracaoAgo: Record<string, unknown> | null = null;
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && body.nova_configuracao_ago) {
      novaConfiguracaoAgo = body.nova_configuracao_ago;
    }
  } catch {
    // Sem body (chamada normal de sincronização manual/idempotente)
  }

  // 2. Se enviada nova configuração, requer permissão de edição do evento
  if (novaConfiguracaoAgo) {
    if (!guard.ctx.perms.podeEditarEvento) {
      return NextResponse.json(
        { error: 'Acesso negado: requer permissão para editar eventos.' },
        { status: 403 }
      );
    }

    const resultado = await salvarConfiguracoesAGOAtomica(guard.ctx.supabaseAdmin, eventoId, novaConfiguracaoAgo);
    if (resultado.erro) {
      return NextResponse.json({ error: resultado.erro }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      sincronizados: resultado.criados + resultado.atualizados,
      criados: resultado.criados,
      atualizados: resultado.atualizados,
    });
  }

  // 3. Chamada sem body: sincroniza estritamente a partir da configuração oficial já salva
  const resultado = await materializarSetoresHospedagemAGO(guard.ctx.supabaseAdmin, eventoId);

  if (resultado.erro) {
    return NextResponse.json({ error: resultado.erro }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    sincronizados: resultado.criados + resultado.atualizados,
    criados:       resultado.criados,
    atualizados:   resultado.atualizados,
  });
}
