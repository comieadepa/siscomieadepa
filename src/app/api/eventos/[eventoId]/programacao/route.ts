import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

// GET /api/eventos/[eventoId]/programacao — público (página de inscrição + assistente)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_programacao')
    .select('*')
    .eq('evento_id', eventoId)
    .order('data', { ascending: true })
    .order('horario', { ascending: true, nullsFirst: true })
    .order('ordem', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ programacao: data ?? [] });
}

// POST /api/eventos/[eventoId]/programacao
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  // ── Auth ──
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

  const body = await req.json();
  const { data: dataEvento, horario, titulo, descricao, palestrante, local, ordem } = body;

  if (!dataEvento || !titulo) {
    return NextResponse.json({ error: 'Data e título são obrigatórios.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_programacao')
    .insert([{
      evento_id:   eventoId,
      data:        dataEvento,
      horario:     horario || null,
      titulo:      String(titulo).trim(),
      descricao:   descricao ? String(descricao).trim() : null,
      palestrante: palestrante ? String(palestrante).trim() : null,
      local:       local ? String(local).trim() : null,
      ordem:       Number(ordem) || 0,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data }, { status: 201 });
}
