import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

const TIPOS_VALIDOS = [
  'mudanca_leito',
  'mudanca_alojamento',
  'atendimento_medico',
  'dano_patrimonio',
  'observacao_geral',
] as const;

/**
 * GET  /api/eventos/[eventoId]/hospedagens/ocorrencia  — lista todas as ocorrências
 * POST /api/eventos/[eventoId]/hospedagens/ocorrencia  — registra nova ocorrência
 * Body: { hospedagem_id, inscricao_id?, tipo, descricao?, operador? }
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('evento_hospedagem_ocorrencias')
    .select(`
      id, tipo, descricao, operador, created_at,
      hospedagem_id, inscricao_id,
      evento_inscricoes ( nome_inscrito, cpf )
    `)
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ocorrencias: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const { hospedagem_id, inscricao_id, tipo, descricao, operador } = body as {
    hospedagem_id?: string;
    inscricao_id?: string;
    tipo?: string;
    descricao?: string;
    operador?: string;
  };

  if (!hospedagem_id || !tipo) {
    return NextResponse.json(
      { error: 'hospedagem_id e tipo são obrigatórios.' },
      { status: 400 },
    );
  }
  if (!TIPOS_VALIDOS.includes(tipo as typeof TIPOS_VALIDOS[number])) {
    return NextResponse.json({ error: 'Tipo de ocorrência inválido.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('evento_hospedagem_ocorrencias')
    .insert({
      evento_id:    eventoId,
      hospedagem_id,
      inscricao_id: inscricao_id ?? null,
      tipo,
      descricao:    descricao?.trim() || null,
      operador:     operador?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ocorrencia: data });
}
