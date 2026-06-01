import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizeUppercase } from '@/lib/text';

// GET /api/eventos/[eventoId]/cupons  — lista cupons (admin)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;
  const { data, error } = await supabase
    .from('evento_cupons')
    .select('*')
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cupons: data ?? [] });
}

// POST /api/eventos/[eventoId]/cupons  — cria novo cupom
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;
  const body = await request.json();
  const { codigo, tipo, valor, limite_uso, validade, ativo } = body;

  if (!codigo || !tipo || valor === undefined) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('evento_cupons')
    .insert([{
      evento_id:  eventoId,
      codigo:     normalizeUppercase(String(codigo).trim()),
      tipo,
      valor:      Number(valor),
      limite_uso: limite_uso ? Number(limite_uso) : null,
      validade:   validade || null,
      ativo:      ativo !== false,
    }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Código de cupom já existe neste evento.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sucesso: true, id: data?.id }, { status: 201 });
}

// PATCH /api/eventos/[eventoId]/cupons  — ativa/desativa (body: { id, ativo })
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;
  const { id, ativo } = await request.json();
  if (!id) return NextResponse.json({ error: 'ID não informado.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_cupons')
    .update({ ativo })
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sucesso: true });
}
