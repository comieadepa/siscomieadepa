import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/eventos/[eventoId]/tipos-inscricao
// Lista os tipos de inscrição ativos de um evento (público)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_tipos_inscricao')
    .select('id, nome, valor, inclui_alimentacao, inclui_hospedagem, ordem')
    .eq('evento_id', eventoId)
    .eq('ativo', true)
    .order('ordem');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tipos: data ?? [] });
}

// POST /api/eventos/[eventoId]/tipos-inscricao
// Cria ou substitui os 3 tipos de inscrição de um evento (admin)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const body  = await request.json();
  const tipos = body?.tipos as Array<{
    id?: string;
    nome: string;
    valor: number;
    inclui_alimentacao: boolean;
    inclui_hospedagem: boolean;
    ativo: boolean;
    ordem: number;
  }>;

  if (!Array.isArray(tipos) || tipos.length === 0) {
    return NextResponse.json({ error: 'Nenhum tipo informado.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Remove os tipos antigos e insere os novos (upsert por id)
  const rows = tipos.map(t => ({
    ...(t.id ? { id: t.id } : {}),
    evento_id:         eventoId,
    nome:              t.nome,
    valor:             t.valor,
    inclui_alimentacao:t.inclui_alimentacao,
    inclui_hospedagem: t.inclui_hospedagem,
    ativo:             t.ativo,
    ordem:             t.ordem,
  }));

  const { error } = await supabase
    .from('evento_tipos_inscricao')
    .upsert(rows, { onConflict: 'id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sucesso: true });
}
