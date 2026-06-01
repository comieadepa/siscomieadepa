import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';

// GET /api/eventos/[eventoId]/alojamentos
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;
  const { data, error } = await supabase
    .from('evento_alojamentos')
    .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo,created_at')
    .eq('evento_id', eventoId)
    .order('nome');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contagem de ocupados via hospedagens confirmadas
  const { data: ocupados } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama, status')
    .eq('evento_id', eventoId)
    .eq('status', 'confirmada');

  const ocupadosPorAlojamento: Record<string, { total: number; inferiores: number; superiores: number }> = {};
  for (const h of ocupados ?? []) {
    if (!h.alojamento_id) continue;
    if (!ocupadosPorAlojamento[h.alojamento_id]) {
      ocupadosPorAlojamento[h.alojamento_id] = { total: 0, inferiores: 0, superiores: 0 };
    }
    ocupadosPorAlojamento[h.alojamento_id].total++;
    if (h.tipo_cama === 'inferior') ocupadosPorAlojamento[h.alojamento_id].inferiores++;
    if (h.tipo_cama === 'superior') ocupadosPorAlojamento[h.alojamento_id].superiores++;
  }

  const result = (data ?? []).map(a => {
    const oc = ocupadosPorAlojamento[a.id] ?? { total: 0, inferiores: 0, superiores: 0 };
    return {
      ...a,
      ocupadas:           oc.total,
      inferiores_usadas:  oc.inferiores,
      superiores_usadas:  oc.superiores,
      vagas_livres:       a.total_vagas    - oc.total,
      inferiores_livres:  a.camas_inferiores - oc.inferiores,
      superiores_livres:  a.camas_superiores - oc.superiores,
    };
  });

  return NextResponse.json({ alojamentos: result });
}

// POST /api/eventos/[eventoId]/alojamentos
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const body = await request.json();
  const { nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores } = body;

  if (!nome?.trim() || !publico?.trim() || total_vagas == null) {
    return NextResponse.json({ error: 'Campos obrigatórios: nome, publico, total_vagas' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const payload = normalizePayloadUppercase({
    evento_id:        eventoId,
    nome:             nome.trim(),
    publico:          publico.trim(),
    sexo:             sexo || null,
    total_vagas:      Number(total_vagas),
    camas_inferiores: Number(camas_inferiores ?? 0),
    camas_superiores: Number(camas_superiores ?? 0),
  });

  const { data, error } = await supabase
    .from('evento_alojamentos')
    .insert([payload])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alojamento: data });
}

// PATCH /api/eventos/[eventoId]/alojamentos
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const updatesNormalized = normalizePayloadUppercase(updates);

  const { error } = await supabase
    .from('evento_alojamentos')
    .update(updatesNormalized)
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/eventos/[eventoId]/alojamentos
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;

  // Verifica se há hospedagens confirmadas neste alojamento
  const { count } = await supabase
    .from('evento_hospedagens')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', id)
    .eq('status', 'confirmada');

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Não é possível excluir: há hospedagens confirmadas neste alojamento.' },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from('evento_alojamentos')
    .delete()
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
