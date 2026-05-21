import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/cartas-advertencia
// Lista cartas de advertência AGO do evento
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('ago_cartas_advertencia')
    .select('id, inscricao_id, ministro_id, motivo, texto_final, status, enviado_para, enviado_em, criado_por, created_at')
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cartas: data ?? [] });
}

// POST /api/eventos/[eventoId]/cartas-advertencia
// Cria rascunho de carta de advertência
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento)
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const body = await request.json();
  const { inscricao_id, motivo, texto_final, ministro_id } = body;

  if (!inscricao_id || !motivo?.trim())
    return NextResponse.json({ error: 'inscricao_id e motivo sao obrigatorios.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('ago_cartas_advertencia')
    .insert([{
      evento_id:   eventoId,
      inscricao_id,
      ministro_id: ministro_id ?? null,
      motivo:      motivo.trim(),
      texto_final: (texto_final ?? '').trim(),
      status:      'rascunho',
    }])
    .select('id, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ carta: data }, { status: 201 });
}
