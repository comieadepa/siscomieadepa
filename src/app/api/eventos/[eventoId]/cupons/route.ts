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
    .select('id, codigo, tipo_desconto, valor, ativo, limite_usos, usos_atuais, validade_inicio, validade_fim, aplicar_todos_tipos, tipos_permitidos, observacoes')
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
  
  const {
    codigo,
    tipo_desconto,
    valor,
    limite_usos,
    validade_inicio,
    validade_fim,
    ativo,
    aplicar_todos_tipos,
    tipos_permitidos,
    observacoes
  } = body;

  if (!codigo || !tipo_desconto || valor === undefined) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data, error } = await supabase
    .from('evento_cupons')
    .insert([{
      evento_id:  eventoId,
      codigo:     normalizeUppercase(String(codigo).trim()),
      tipo_desconto,
      valor:      Number(valor),
      limite_usos: limite_usos ? Number(limite_usos) : null,
      validade_inicio: validade_inicio || null,
      validade_fim: validade_fim || null,
      ativo:      ativo !== false,
      aplicar_todos_tipos: aplicar_todos_tipos !== false,
      tipos_permitidos: Array.isArray(tipos_permitidos) ? tipos_permitidos : [],
      observacoes: observacoes || null,
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

// PUT /api/eventos/[eventoId]/cupons  — atualiza cupom completo
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;
  
  const body = await request.json();
  const {
    id,
    codigo,
    tipo_desconto,
    valor,
    limite_usos,
    validade_inicio,
    validade_fim,
    ativo,
    aplicar_todos_tipos,
    tipos_permitidos,
    observacoes
  } = body;

  if (!id) return NextResponse.json({ error: 'ID não informado.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;

  const { error } = await supabase
    .from('evento_cupons')
    .update({
      codigo:     codigo ? normalizeUppercase(String(codigo).trim()) : undefined,
      tipo_desconto,
      valor:      valor !== undefined ? Number(valor) : undefined,
      limite_usos: limite_usos !== undefined ? (limite_usos ? Number(limite_usos) : null) : undefined,
      validade_inicio: validade_inicio !== undefined ? (validade_inicio || null) : undefined,
      validade_fim: validade_fim !== undefined ? (validade_fim || null) : undefined,
      ativo:      ativo !== undefined ? !!ativo : undefined,
      aplicar_todos_tipos: aplicar_todos_tipos !== undefined ? !!aplicar_todos_tipos : undefined,
      tipos_permitidos: Array.isArray(tipos_permitidos) ? tipos_permitidos : undefined,
      observacoes: observacoes !== undefined ? (observacoes || null) : undefined,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sucesso: true });
}

// DELETE /api/eventos/[eventoId]/cupons — remove cupom
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;
  
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID não informado.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_cupons')
    .delete()
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sucesso: true });
}
