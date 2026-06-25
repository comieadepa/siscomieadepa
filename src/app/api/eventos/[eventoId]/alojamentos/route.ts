import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';

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
    .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,colchonetes,ativo,created_at')
    .eq('evento_id', eventoId)
    .order('nome');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contagem de ocupados via hospedagem leitos (ocupado = true)
  const { data: leitosOcupados } = await supabase
    .from('evento_hospedagem_leitos')
    .select('alojamento_id, posicao')
    .eq('evento_id', eventoId)
    .eq('ocupado', true);

  const { data: hospOcupadas } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama')
    .eq('evento_id', eventoId)
    .in('status', ['alocada', 'confirmada', 'checkin_realizado']);

  const ocupadosPorAlojamento: Record<string, { total: number; inferiores: number; superiores: number }> = {};

  const processOcupante = (alojId: string, tipoCama: string | null) => {
    if (!alojId) return;
    if (!ocupadosPorAlojamento[alojId]) {
      ocupadosPorAlojamento[alojId] = { total: 0, inferiores: 0, superiores: 0 };
    }
    ocupadosPorAlojamento[alojId].total++;
    if (tipoCama === 'inferior') ocupadosPorAlojamento[alojId].inferiores++;
    if (tipoCama === 'superior') ocupadosPorAlojamento[alojId].superiores++;
  };

  // Se houver leitos reais ocupados, usá-los prioritariamente
  if ((leitosOcupados ?? []).length > 0) {
    for (const l of leitosOcupados!) {
      processOcupante(l.alojamento_id, l.posicao === 'unico' ? null : l.posicao);
    }
  } else {
    for (const h of hospOcupadas ?? []) {
      processOcupante(h.alojamento_id, h.tipo_cama);
    }
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
  const { nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, colchonetes } = body;

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
    colchonetes:      Number(colchonetes ?? 0),
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

  // 1. Buscar alojamento atual
  const { data: currentAloj, error: errFetch } = await supabase
    .from('evento_alojamentos')
    .select('nome, publico, total_vagas, camas_inferiores, camas_superiores, colchonetes, ativo')
    .eq('id', id)
    .eq('evento_id', eventoId)
    .single();

  if (errFetch || !currentAloj) {
    return NextResponse.json({ error: 'Alojamento não encontrado.' }, { status: 404 });
  }

  // 2. Calcular ocupação atual
  const { count: leitosCount } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', id)
    .eq('ocupado', true);

  let totalOcupados = leitosCount ?? 0;
  if (totalOcupados === 0) {
    const { count: hospCount } = await supabase
      .from('evento_hospedagens')
      .select('id', { count: 'exact', head: true })
      .eq('alojamento_id', id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado']);
    totalOcupados = hospCount ?? 0;
  }

  // 3. Validar nova capacidade >= ocupados
  const newTotal = updates.total_vagas !== undefined ? Number(updates.total_vagas) : currentAloj.total_vagas;
  if (newTotal < totalOcupados) {
    return NextResponse.json(
      { error: `Não é possível reduzir a capacidade abaixo da quantidade de leitos ocupados (${totalOcupados} ocupados).` },
      { status: 400 }
    );
  }

  // 4. Validar se tenta alterar grupo/público com hóspedes alocados
  const newPublico = updates.publico !== undefined ? String(updates.publico) : currentAloj.publico;
  if (newPublico !== currentAloj.publico && totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível alterar o público/grupo de um alojamento com hóspedes alocados.' },
      { status: 400 }
    );
  }

  // 5. Validar desativação de alojamento com hóspedes alocados
  const newAtivo = updates.ativo !== undefined ? !!updates.ativo : currentAloj.ativo;
  if (!newAtivo && totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível desativar o alojamento porque existem hospedagens alocadas nele. Realoque os ocupantes primeiro.' },
      { status: 400 }
    );
  }

  // 6. Atualizar registro
  const updatesNormalized = normalizePayloadUppercase(updates);
  const { error: errUpdate } = await supabase
    .from('evento_alojamentos')
    .update(updatesNormalized)
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (errUpdate) return NextResponse.json({ error: errUpdate.message }, { status: 500 });

  // 7. Registrar auditoria
  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'alojamento_editado',
    modulo: 'hospedagem',
    entidade: 'evento_alojamentos',
    entidadeId: id,
    descricao: `[Hospedagem] Alojamento "${updates.nome || currentAloj.nome}" editado. Capacidade: ${currentAloj.total_vagas} -> ${newTotal}.`,
    detalhes: {
      alojamento_id: id,
      capacidade_anterior: currentAloj.total_vagas,
      capacidade_nova: newTotal,
      leitos_inferiores_anterior: currentAloj.camas_inferiores,
      leitos_inferiores_novo: updates.camas_inferiores !== undefined ? Number(updates.camas_inferiores) : currentAloj.camas_inferiores,
      leitos_superiores_anterior: currentAloj.camas_superiores,
      leitos_superiores_novo: updates.camas_superiores !== undefined ? Number(updates.camas_superiores) : currentAloj.camas_superiores,
      colchonetes_anterior: currentAloj.colchonetes || 0,
      colchonetes_novo: updates.colchonetes !== undefined ? Number(updates.colchonetes) : (currentAloj.colchonetes || 0),
      operador: guard.ctx.user?.email ?? 'desconhecido'
    },
    request,
  });

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

  // Verifica se há hospedagens ocupadas neste alojamento
  const { count: leitosCount } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', id)
    .eq('ocupado', true);

  let totalOcupados = leitosCount ?? 0;
  if (totalOcupados === 0) {
    const { count: hospCount } = await supabase
      .from('evento_hospedagens')
      .select('id', { count: 'exact', head: true })
      .eq('alojamento_id', id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado']);
    totalOcupados = hospCount ?? 0;
  }

  if (totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível excluir: há hospedagens ocupadas neste alojamento.' },
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
